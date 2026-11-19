async page => {
  const origin = 'http://127.0.0.1:4388';
  page.setDefaultTimeout(8000);
  await page.setViewportSize({width:1200,height:850});
  const board = await (await page.request.get(origin + '/api/board')).json();
  const summary = await (await page.request.get(origin + '/api/roster?summary=1')).json();
  if (!Array.isArray(summary.members)) throw Error('Roster summary endpoint failed');
  board.guestsEnabled = true;
  const party = {...board.parties[0], id:'first', signups:[{name:'Me',role:0,mine:true}]};
  board.parties = [party];
  const roster = {guild:{id:'guild',name:'DAGIT'},region:'asia',members:[{id:'member1',name:'Member One'}]};
  const guests = {guests:true,region:'asia',members:[{id:'guest1',name:'Guest One',guild:'Other Guild'}]};
  let observedRosters = 0;
  await page.route('**/app.js', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('refreshDelay = 12000','refreshDelay = 250')
      .replace('Math.random() * 3000','0').replaceAll('45000','500');
    await route.fulfill({response,body});
  });
  await page.route('**/api/board', route => route.fulfill({json:board}));
  await page.route('**/api/roster*', route => {
    const search = new URL(route.request().url()).searchParams;
    observedRosters++;
    return route.fulfill({json:search.has('guests') ? guests : roster});
  });
  const desktop = page.locator('.desktop-nav');
  const control = tab => desktop.locator('[data-page="' + tab + '"]');
  const badge = tab => control(tab).locator('.nav-unread');
  const waitForBadge = (tab, count) => badge(tab).filter({hasText:new RegExp('^' + count + '$')}).waitFor();
  await page.goto(origin);
  await control('profile').count();
  await control('mine').click();
  for (let attempts = 0; observedRosters < 2 && attempts < 20; attempts++) {
    await new Promise(resolve => setTimeout(resolve,100));
  }
  if (observedRosters < 2) throw Error('Background roster polls not started');
  await control('board').click();
  if (await page.locator('.nav-unread:visible').count()) throw Error('Existing data showed as unread');
  party.title = 'Edited signup';
  board.parties.push({...party,id:'second',title:'Another party',signups:[]});
  roster.members.push({id:'member2',name:'Member Two'});
  guests.members[0].guild = 'New Guild';
  board.expertise = ['healer'];
  await waitForBadge('mine',1);
  await waitForBadge('roster',1);
  await waitForBadge('guests',1);
  await page.locator('.profile-tile .nav-unread').waitFor();
  if (await badge('board').isVisible()) throw Error('Open tab showed an unread badge');
  await control('roster').click();
  await badge('roster').waitFor({state:'hidden'});
  const member = id => page.locator('[data-guild-member="' + id + '"]');
  const dot = row => row.locator('.item-unread');
  await dot(member('member2')).waitFor();
  if (await dot(member('member1')).count()) throw Error('An unchanged member was marked');
  await member('member2').click();
  await dot(member('member2')).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await waitForBadge('guests',1);
  party.title = 'Edited again';
  board.parties[1].title = 'Also edited';
  await waitForBadge('board',2);
  await waitForBadge('mine',1);
  await page.setViewportSize({width:390,height:840});
  const mobile = page.locator('.mobile-nav');
  const mobileBoard = mobile.getByRole('button',{name:'Party board, 2 unread updates'});
  const mobileCount = mobileBoard.locator('.nav-unread');
  await mobileCount.waitFor();
  const [badgeBox, buttonBox] = await Promise.all([mobileCount.boundingBox(), mobileBoard.boundingBox()]);
  if (badgeBox.x < buttonBox.x + buttonBox.width / 2 || badgeBox.y > buttonBox.y + 5) {
    throw Error('Mobile badge is outside its upper-right position');
  }
  await mobileBoard.click();
  await mobileCount.waitFor({state:'hidden'});
  await mobile.getByRole('button',{name:'Guests, 1 unread update'}).waitFor();
  const partyButton = id => page.locator('[data-party="' + id + '"]');
  const row = id => page.locator('.party').filter({has:partyButton(id)});
  await dot(row('first')).waitFor();
  await dot(row('second')).waitFor();
  await partyButton('first').click();
  await dot(row('first')).waitFor({state:'detached'});
  await dot(row('second')).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await mobile.getByRole('button',{name:'Guests, 1 unread update'}).click();
  await dot(member('guest1')).waitFor();
  await member('guest1').click();
  await dot(member('guest1')).waitFor({state:'detached'});
  await page.getByRole('button',{name:'Close',exact:true}).click();
  guests.members[0].playRoles = ['Healer'];
  guests.members.push({id:'guest2',name:'Guest Two'});
  await dot(member('guest1')).waitFor();
  await dot(member('guest2')).waitFor();
  await member('guest2').click();
  await dot(member('guest2')).waitFor({state:'detached'});
  await dot(member('guest1')).waitFor();
  return 'Verified that new and updated parties, members and guests keep their own dots when a tab opens and clear independently when viewed.';
}
