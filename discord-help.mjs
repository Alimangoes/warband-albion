// Keep these topics current when a Warband workflow or Discord command changes.
export const helpTopics = {
  setup: { title: 'Getting started', description: [
    '1. Open the Warband website or follow a party link in Discord. Choose **Continue with Discord**.',
    '2. Complete Discord membership screening and get one of the server’s allowed sign-in roles if required.',
    '3. Enter your exact Albion character name. If nickname matching is enabled, register with Albion Assistant first. Guild members link a character in the configured guild. Members with the designated Guest role link a character outside that guild, in the same region. A character can be linked to one Warband account in this workspace.',
    '4. Select your play roles and **Save roles** to reach the board. On mobile, navigate with the bottom icons. Organizers also see Settings.'
  ].join('\n') },
  signups: { title: 'Find and join a party', description: [
    '1. Open **Party Board**, filter by **All parties**, **Open slots**, or **My signups**, then select **View party**.',
    '2. Check the start time, meetup location, and notes. Hover over or focus a recommended gear icon for item details.',
    '3. Click **Claim slot** on the website or tap a role on the Discord announcement. You can hold one slot per party. Claim a different available role to switch. To release your slot, tap your current role again or use **Leave party** in Discord, or click **Leave** on the website.',
    '4. Use **My signups** to find your parties. Scheduled signups close at the start time. Parties set to **Wait until full** show **Ready** once all slots are filled. An organizer can close either type of party.'
  ].join('\n') },
  profile: { title: 'Profile and guild members', description: [
    '• In **Profile**, refresh your linked character, change your play roles, or sign out. **Save roles** syncs roles managed by Warband to Discord. Unlinking clears those selections and removes the assigned Warband roles.',
    '• Search **Guild members**, then select a profile for Warband roles, **Kills** and **Deaths**. The open tab refreshes as Albion publishes events. Expand a fight for gear, victim inventory, fame, fight type, and silver estimates.',
    '• **Guests** lists linked guest characters and their guild. Open a guest to see the same combat tabs. Guests can join open parties. Guild-only parties are hidden on their board and reject Discord signups.',
    '• The crown marks the configured guild master. The checkmark marks a linked Warband account. The scales mark organizer access.'
  ].join('\n') },
  organize: { title: 'Create and manage parties', description: [
    '1. Select **Create party** on the board. Enter the name, activity, meetup location, and any notes. Choose a future start time or turn on **Wait until full**.',
    '2. Add named roles with up to **20 total slots**. Add optional recommended gear using the item search, tier, enchantment, and quality controls.',
    '3. Choose whether to require Albion guild membership, post the Discord announcement in a public thread, or mention selected Discord roles.',
    '4. Click **Publish party** to add it to the board and announce it. Open the party to edit it or retry a failed announcement.',
    '5. Use **Ping roster** on the party card to mention everyone with a claimed slot in its Discord thread. Warband also posts a gear-up reminder in the thread the first time every slot is filled.',
    '6. Open **View party** and click **Remove** beside a signup to free a member or guest’s slot and update the Discord announcement.',
    '• **/warband-assign party: player: role:** assigns or moves a registered player to an available slot. Select party and role suggestions. Normal sign-in and guild requirements apply.',
    '• **/warband-remove party: player:** frees the selected player’s slot. Both organizer commands update Warband and the announcement.',
    '7. **Finish** closes signups and keeps the roster. **Cancel party** closes the run. **Delete** removes the party and its linked Discord thread when the bot has **Manage Threads**.'
  ].join('\n') },
  templates: { title: 'Templates and /warband', description: [
    '• Use **Save template** in the party form. Templates are shared by all organizers. Open **Templates** to reuse, edit, or delete one. Saving an opened template updates that template, including its saved start time.',
    '• The template library updates automatically. If someone saves while you have a draft open, **Save template** asks you to choose **Override changes** to save your draft over their version or **Cancel changes** to discard your draft.',
    '• With a saved template, organizers can use **/warband**. Select **template**, optionally replace **note**, and enter a future **start** in Philippine time (UTC+8). Omit **start** for **Wait until full** templates.',
    '• Use **MM/DD/YYYY hh:mm AM or PM** for the Discord start. The command uses the time you enter and publishes to the board and the configured announcement channel, with the template’s thread and mention settings.'
  ].join('\n') },
  settings: { title: 'Server admin settings', description: [
    '1. In **Settings**, choose the Discord organizer role and announcement channel. Set the Albion region and guild ID. Enter the current guild master’s exact Albion name to show the crown.',
    '2. To restrict sign-ins, enable **Require a Discord role to sign in** and select all allowed roles. Any one suffices. Set the **Guest role** to the role Albion Assistant assigns to guests, and include it in the allowed list if the restriction is enabled.',
    '• All parties use the announcement channel. Guests with channel access can see announcements, while guild-only runs stay hidden on their web board and reject their Discord signups.',
    '• Enable **Require Discord server nickname to match Albion character** if your server uses Albion Assistant to set nicknames. This applies to new character links.',
    '• Enable **Warband guide**, select a text channel, and **Save guide**. Saving again edits the post. Warband needs **View Channel**, **Send Messages**, and **Embed Links**.',
    '3. Under **Discord roles**, add or uncheck roles, then click **Save roles**. Use **Sync Discord roles** to restore missing managed roles. The bot needs **Manage Roles**, with its own role above the roles it manages.',
    '4. Bot channel permissions require **View Channel** and **Send Messages**. Threads also need **Create Public Threads**, **Send Messages in Threads**, and **Manage Threads** for deletion. Commands and buttons use the app’s Interactions Endpoint.'
  ].join('\n') }
};

export const helpCommand = {
  name: 'help', type: 1, description: 'Learn how to use Warband',
  options: [{ name: 'topic', type: 3, description: 'Open one section of the guide',
    choices: Object.entries(helpTopics).map(([value, { title: name }]) => ({ name, value })) }]
};

export function helpReply(event, website) {
  const selected = event.data.options?.find(option => option.name === 'topic')?.value;
  const topics = Object.hasOwn(helpTopics, selected) ? [helpTopics[selected]] : Object.values(helpTopics);
  return {
    flags: 64,
    content: '**Warband help**\n[Open the Warband website](<' + website + '>)',
    embeds: topics.map(topic => ({ ...topic, color: 0xeab77b })),
    allowed_mentions: { parse: [] }
  };
}
