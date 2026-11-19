const later = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
export const demoRoles = [{ id: '1', name: 'Guild Officer' }, { id: '2', name: 'Raid Leader' }, { id: '3', name: 'Guild Member' }];
export const demoChannels = [{ id: '1', name: 'party-recruitment' }, { id: '2', name: 'guild-events' }, { id: '3', name: 'general' }];
export const demoSettings = {
  guildId: 'demo', server: 'Ashen Vanguard', roleId: '1', channelId: '1', channel: 'party-recruitment',
  region: 'asia', albionGuild: { id: 'demo', name: 'Ashen Vanguard', master: { id: 'demo-ironwarden', name: 'Ironwarden' } }
};
const makeParty = (id, title, type, hours, zone, summary, roles, signups, host) => ({
  id, title, type, starts: later(hours), zone, summary, roles: roles.map(([name, count]) => ({ name, count })),
  signups: signups.map(([role, name], i) => ({ role, name, user: 'sample-' + i })), host,
  hostId: 'sample-host', channel: 'party-recruitment', guildOnly: false, announcement: 'demo'
});
export const demoParties = () => [
  makeParty('sample-avalon', 'Avalonian Roads Roam', 'Roads of Avalon', 5, 'Thetford Portal',
    'A small-scale roam through the Roads. Bring a 4.1 escape set and a gathering tool if you have one.',
    [['Tank', 1], ['Healer', 1], ['DPS', 3], ['Support', 2]],
    [[0, 'Ironwarden'], [2, 'Ashborne'], [2, 'Mistral'], [3, 'Nightbloom']], 'Ironwarden'),
  makeParty('sample-dungeon', 'T8 Group Dungeons', 'PvE', 24, 'Fort Sterling',
    'Running enchanted maps. Bring your main set, food, and a repair silver buffer.',
    [['Tank', 1], ['Healer', 1], ['DPS', 3]],
    [[0, 'Thornhelm'], [1, 'Lunara'], [2, 'Blackfen']], 'Thornhelm'),
  makeParty('sample-blackzone', 'Black Zone Gathering', 'Gathering', 48, 'Lymhurst Portal',
    'Gather resources with a group and watch each other’s backs on the way home.',
    [['Scout', 1], ['Gatherer', 4], ['Escort', 1]], [[0, 'Wolfsbane'], [1, 'Greywillow']], 'Wolfsbane')
];
export const demoRoster = ['Ironwarden', 'Ashborne', 'Mistral', 'Nightbloom', 'Thornhelm', 'Lunara', 'Blackfen', 'Wolfsbane', 'Greywillow'];
