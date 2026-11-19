async page => {
  const origin = 'http://127.0.0.1:4388';
  const board = await (await page.request.get(origin + '/api/board')).json();
  board.canManage = true;
  const party = {...board.parties[0], id:'removal-fixture', waitUntilFull:true, finished:false, cancelled:false,
    roles:[{name:'Tank',count:2}], signups:[
      {name:'Guild Member',role:0,signupId:'1111111111111111111111'},
      {name:'Visiting Guest',role:0,signupId:'2222222222222222222222'}
    ]};
  board.parties = [party];
  await page.route('**/api/board', route => route.fulfill({json:board}));
  let action;
  await page.route('**/api/party/action', route => {
    action = route.request().postDataJSON();
    party.signups = party.signups.filter(entry => entry.signupId !== action.signupId);
    return route.fulfill({json:party});
  });
  await page.addInitScript(() => { window.confirm = message => message.includes('Visiting Guest'); });
  await page.setViewportSize({width:390,height:840});
  await page.goto(origin);
  await page.getByRole('button',{name:'View party'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Remove Guild Member from party'}).waitFor();
  await dialog.getByRole('button',{name:'Remove Visiting Guest from party'}).click();
  await dialog.getByRole('button',{name:'Claim slot',exact:true}).waitFor();
  if (action?.action !== 'remove-signup' || action?.signupId !== '2222222222222222222222') throw Error('Wrong signup targeted');
  if (await dialog.getByRole('button',{name:'Remove Visiting Guest from party'}).count()) throw Error('Guest still listed');
  await dialog.getByRole('button',{name:'Remove Guild Member from party'}).waitFor();
  board.canManage = false;
  await page.reload();
  await page.getByRole('button',{name:'View party'}).click();
  await dialog.getByText('Guild Member',{exact:true}).waitFor();
  if (await dialog.getByRole('button',{name:/^Remove/}).count()) throw Error('Remove shown to a non-organizer');
  return 'Organizer removal and reopened slot verified on the mobile party dialog.';
}
