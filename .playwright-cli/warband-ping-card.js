async page => {
  const origin = 'http://127.0.0.1:4388';
  const board = await (await page.request.get(origin + '/api/board')).json();
  const first = {...board.parties[0], id:'ping-fixture', canPingRoster:true};
  board.parties = [first, {...first,id:'no-thread',canPingRoster:false}];
  await page.route('**/api/board', route => route.fulfill({json:board}));
  let action;
  await page.route('**/api/party/action', route => {
    action = route.request().postDataJSON();
    return route.fulfill({json:first});
  });
  await page.addInitScript(() => {
    window.confirm = message => {
      window.pingPrompt = message;
      return true;
    };
  });
  await page.goto(origin);
  const ping = page.getByRole('button',{name:'Ping roster',exact:true});
  await ping.waitFor();
  if (await ping.count() !== 1) throw Error('Unexpected Ping roster visibility');
  for (const width of [390,600,1130,1480]) {
    await page.setViewportSize({width,height:920});
    const fits = await ping.evaluate(el => {
      const button = el.getBoundingClientRect(), card = el.closest('.party').getBoundingClientRect();
      return button.left >= card.left && button.right <= card.right && document.documentElement.scrollWidth <= innerWidth;
    });
    if (!fits) throw Error('Ping button overflows at ' + width);
  }
  await ping.click();
  await page.getByText('Roster ping simulated.',{exact:true}).waitFor();
  if (action?.action !== 'ping' || action?.id !== first.id) throw Error('Wrong button action');
  if (!await page.evaluate(() => window.pingPrompt.includes('everyone who claimed a slot'))) throw Error('Missing confirmation');
  board.canManage = false;
  await page.reload();
  await page.getByRole('button',{name:'View party'}).first().waitFor();
  if (await ping.count()) throw Error('Non-organizer sees Ping roster');
  return 'Card layout at four widths, manual ping, and organizer visibility verified.';
}
