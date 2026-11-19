import { randomBytes } from 'node:crypto';
import { discord, Problem } from './providers.mjs';

function guideMessage(base) {
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      author: { name: 'Warband', icon_url: new URL('/warband-favicon.png', base).href },
      title: 'Get started with Warband',
      url: base.href,
      color: 0xeab77b,
      description: 'Use Warband to Join event parties, check recommended gear, and claim a role before the run.',
      fields: [{ name: 'How to join a party', value: [
        '1. Continue with Discord using your server account. If the server uses Albion Assistant, register there first.',
        '2. Link your Albion character and save the roles you play.',
        '3. Choose a party on the board or open a Discord announcement, then claim an available slot.', '',
        'Guests can join open parties. Guild-only runs are reserved for eligible guild members.'
      ].join('\n') }]
    }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Open Warband', url: base.href }] }]
  };
}

const snowflake = id => typeof id === 'string' && /^\d{17,20}$/.test(id);
const messages = channelId => '/channels/' + channelId + '/messages';

export async function withRecordLock(db, key, busy, run) {
  const lease = randomBytes(16).toString('hex');
  await db.change(key, {}, Date.now() + 60000, state => {
    if (state.active) throw new Problem(409, busy);
    state.active = lease;
  });
  try {
    return await run();
  } finally {
    await db.change(key, {}, Date.now() + 60000, state => {
      if (state.active === lease) delete state.active;
    });
  }
}

export function createDiscordGuide({ db, bot, base, guildId }) {
  const legacyKey = guildId + ':discord-guide';
  const key = guildId + ':discord-guide-static'; // Retire the storage key watched by earlier workers.
  const locked = run => withRecordLock(db, legacyKey + ':sync', 'The Warband guide is already being updated. Try again shortly.', run);
  async function moveLegacyRecord() {
    let state = await db.get(key);
    const legacy = await db.get(legacyKey);
    if (legacy) {
      if (!state) {
        state = legacy;
        await db.put(key, state);
      }
      await db.remove(legacyKey);
    }
    return state ?? {};
  }
  const editPost = post => discord(messages(post.channelId) + '/' + post.messageId, bot, guideMessage(base), 'PATCH');
  async function removePost(post) {
    if (!post?.messageId) return;
    await discord(messages(post.channelId) + '/' + post.messageId, bot, undefined, 'DELETE').catch(error => {
      if (error.upstreamStatus !== 404) throw error;
    });
  }
  async function replace(state, channelId) {
    if (state.pending && (!state.pending.unpinned || state.pending.channelId !== channelId)) {
      await removePost(state.pending);
      delete state.pending;
      await db.put(key, state);
    }
    if (!channelId) {
      await removePost(state.active);
      await db.remove(key);
      return;
    }
    if (!state.pending) state.pending = { channelId, unpinned: true, nonce: randomBytes(16).toString('base64url') };
    const post = state.pending;
    if (!post.messageId) {
      await db.put(key, state);
      const msg = await discord(messages(channelId), bot, { ...guideMessage(base), nonce: post.nonce, enforce_nonce: true });
      if (!snowflake(msg?.id)) throw new Problem(502, 'Discord did not return a guide message ID. Try saving again.');
      post.messageId = msg.id;
      await db.put(key, state);
    }
    await removePost(state.active);
    await db.put(key, { active: { channelId, messageId: post.messageId, unpinned: true }, copyVersion: 1 });
  }
  return {
    async status() {
      const { active, pending } = (await db.get(key)) ?? await db.get(legacyKey, {});
      return { enabled: Boolean(active || pending), channelId: pending?.channelId || active?.channelId || '',
        messageUrl: active ? 'https://discord.com/channels/' + guildId + '/' + active.channelId + '/' + active.messageId : '',
        pending: Boolean(pending) };
    },
    async updatePublishedCopy() {
      const saved = await db.get(key);
      if (!await db.get(legacyKey) && (!saved || saved.copyVersion === 1)) return false;
      return locked(async () => {
        const state = await moveLegacyRecord();
        if (state.copyVersion === 1) return false;
        const post = state.pending?.messageId ? state.pending : state.active;
        const updated = post?.messageId && await editPost(post).then(() => true).catch(error => {
          if (error.upstreamStatus === 404) return false;
          throw error;
        });
        if (post?.messageId && !updated) {
          await removePost(state.pending);
          delete state.pending;
          await replace(state, post.channelId);
          return true;
        }
        if (updated && post === state.pending) {
          await replace(state, post.channelId);
          return true;
        }
        delete state.updateCopy;
        state.copyVersion = 1;
        await db.put(key, state);
        return Boolean(updated);
      });
    },
    save: channelId => locked(async () => {
      const state = await moveLegacyRecord();
      if (!channelId || state.active?.channelId !== channelId) return replace(state, channelId);
      await editPost(state.active).catch(error => {
        if (error.upstreamStatus !== 404) throw error;
        throw new Problem(404, 'The guide was deleted in Discord. Turn the guide off and save, then enable it to publish a new one.');
      });
      if (state.pending) {
        await removePost(state.pending);
        delete state.pending;
      }
      delete state.updateCopy;
      state.copyVersion = 1;
      await db.put(key, state);
    })
  };
}
