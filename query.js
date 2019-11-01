const Pool = require('pg').Pool;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true
})

const getChannels = async () => {
  const query = `
    select
      servers.id as server_id,
      servers.name as server_name,
      servers.discord_id as server_discord_id,
      channels.id as channel_id,
      channels.name as channel_name,
      channels.discord_id as channel_discord_id,
      watch
    from servers
    inner join channels on channels.server_id = servers.id;
  `;

  const response = await pool.query(query);
  return response.rows;
}

const getAllUsers = async (server_id) => {
  const query = `
    select
      users.id as id,
      username,
      amount,
      currency,
      discord_id
    from users
    inner join money on money.user_id = users.id
    where server_id = ${server_id};
  `;

  const response = await pool.query(query);
  return response.rows;
}

const getAllUsersWithBets = async (server_id) => {
  const query = `
    select
      users.id as id,
      username,
      min(money.amount) as banked,
      sum(bets.amount) as bets,
      max(money.currency) as currency
    from users
    inner join money on money.user_id = users.id
    left join bets on bets.user_id = users.id
    where server_id = ${server_id}
    group by users.id, username;
  `;

  const response = await pool.query(query);
  return response.rows;
}

const openBetting = async (server_id) => {
  return await pool.query(`update state set config_value = 1 where config_name = 'open' and server_id = ${server_id};`);
}

const closeBetting = async (server_id) => {
  return await pool.query(`update state set config_value = 0 where config_name = 'open' and server_id = ${server_id};`);
}

const isBettingOpen = async (server_id) => {
  const response = await pool.query(`select config_value from state where config_name = 'open' and server_id = ${server_id}`);
  return response.rows[0].config_value === 1;
}

const getUser = async (discord_id = null, username = null, server_id) => {
  let and = '';

  if (discord_id !== null) {
    and = `and discord_id = '${discord_id}'`;
  } else if (username !== null) {
    and = `and lower(username) = lower('${username}')`;
  }

  const query = `
    select
      users.id as id,
      username,
      discord_id,
      money.id as money_id,
      currency,
      amount
    from users
    inner join money on users.id = money.user_id
    where server_id = ${server_id}
      ${and};
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const setUsersMoney = async (user_id, amount) => {
  const query = `
    update money
    set amount = ${amount}
    where money.user_id = ${user_id};
  `;

  const response = await pool.query(query);
}

const updateUsersMoney = async (user_id, amount) => {
  const query = `
    update money
    set amount = amount + ${amount}
    where money.user_id = ${user_id};
  `;

  const response = await pool.query(query);
}

const createUser = async (username, discord_id, server_id) => {
  const query = `
    insert into users (username, discord_id, server_id)
    values ('${username}', '${discord_id}', ${server_id})
    returning id, username, discord_id;
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const createMoney = async (user_id, currency, amount) => {
  const query = `
    insert into money (user_id, currency, amount)
    values (${user_id}, '${currency}', ${amount});
  `;

  const response = await pool.query(query);
}

const createBet = async (user_id, captain_id, currency, amount) => {
  const query = `
    insert into bets (user_id, captain_id, currency, amount)
    values (${user_id}, ${captain_id}, '${currency}', ${amount});
  `;

  const response = await pool.query(query);
}

const getCaptains = async (username = null, server_id) => {
  const and =  username ? `and lower(username) = lower('${username}')` : '';

  const query = `
    select
      captains.id, user_id, username, discord_id
    from captains
    inner join users on captains.user_id = users.id
    where users.server_id = ${server_id}
      ${and};
  `;

  const response = await pool.query(query);

  return response.rows;
}

const getAllBets = async (discord_id = null, server_id) => {
  const and = discord_id ? `and bet_user.discord_id = '${discord_id}'` : '';

  const query = `
    select
      bet_user.username as username,
      bets.amount,
      bets.currency,
      captain_user.username as captain
    from bets
    inner join users as bet_user on bets.user_id = bet_user.id
    inner join captains on bets.captain_id = captains.id
    inner join users as captain_user on captains.user_id = captain_user.id
    where bet_user.server_id = ${server_id}
      ${and};
  `;

  const response = await pool.query(query);

  return response.rows;
}

const updateCurrency = async (newCurrencyName, user_id) => {
  const updateMoneyQuery = `
    update money
    set currency = '${newCurrencyName}'
    where user_id = ${user_id};
  `;

  const updateBetsQuery = `
    update bets
    set currency = '${newCurrencyName}'
    where user_id = ${user_id};
  `;

  await pool.query(updateMoneyQuery);
  await pool.query(updateBetsQuery);
}

const getAdmin = async (discord_id = null) => {
  const where = discord_id ? `where users.discord_id = '${discord_id}'` : '';

  const query = `
    select
      user_id,
      username,
      discord_id
    from admins
    inner join users on admins.user_id = users.id
    ${where};
  `;

  const response = await pool.query(query);

  if (discord_id) {
    if (response.rows && response.rows.length) {
      return response.rows[0];
    }
  } else {
    return response.rows;
  }
}

const createAdmin = async (user_id) => {
  const query = `
    insert into admins (user_id)
    values (${user_id})
    returning id;
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const deleteAdmins = async (adminIds) => {
  const query = `
    DELETE FROM admins USING users
    WHERE users.id = admins.user_id
      AND users.discord_id in ('${adminIds.join('\',\'')}');
  `;

  const response = await pool.query(query);
}

const updateUsername = async (discord_id, username) => {
  const query = `
    update users
    set username = '${username}'
    where users.discord_id = '${discord_id}';
  `;

  const response = await pool.query(query);
}

const createCaptain = async (user_id) => {
  const query = `
    insert into captains (user_id)
    values (${user_id})
    returning id;
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const deleteCaptains = async (captainIds) => {
  const query = `
    DELETE FROM captains USING users
    WHERE users.id = captains.user_id
      AND users.discord_id in ('${captainIds.join('\',\'')}');
  `;

  const response = await pool.query(query);
}

const createWinner = async (captain_id) => {
  const query = `
    insert into winners (captain_id)
    values (${captain_id})
    returning id;
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const getWinners = async () => {
  const query = `
    select
      users.username
    from winners
    inner join captains on winners.captain_id = captains.id
    inner join users on captains.user_id = users.id;
  `;

  const response = await pool.query(query);

  return response.rows;
}

const deleteWinner = async (captain_id) => {
  const query = `
    DELETE FROM winners
    WHERE captain_id = ${captain_id};
  `;

  const response = await pool.query(query);
}

const createTie = async (captain_id) => {
  const query = `
    insert into ties (captain_id)
    values (${captain_id})
    returning id;
  `;

  const response = await pool.query(query);

  if (response.rows && response.rows.length) {
    return response.rows[0];
  }
}

const getTies = async () => {
  const query = `
    select
      users.username
    from ties
    inner join captains on ties.captain_id = captains.id
    inner join users on captains.user_id = users.id;
  `;

  const response = await pool.query(query);

  return response.rows;
}

const deleteTie = async (captain_id) => {
  const query = `
    DELETE FROM ties
    WHERE captain_id = ${captain_id};
  `;

  const response = await pool.query(query);
}

const getBettingResults = async (server_id) => {
  const query = `
    select
      bets.user_id as user_id,
      bets.currency,
      bets.amount,
      case
        when winners.id is not null then 2
        when ties.id is not null then 1
        else 0
      end as result,
      users_captain.username as captain_username,
      users_user.username as username
    from bets
    left join winners on bets.captain_id = winners.captain_id
    left join ties on bets.captain_id = ties.captain_id
    inner join captains on bets.captain_id = captains.id
    inner join users as users_captain on captains.user_id = users_captain.id
    inner join users as users_user on bets.user_id = users_user.id
    where users_user.server_id = ${server_id};
  `;

  const response = await pool.query(query);

  return response.rows;
}

const resetBetting = async (server_id) => {
  const resetTies = `
    delete from ties
    where exists (
      select 1
      from captains
      inner join users on captains.user_id = users.id
      where server_id = ${server_id} and ties.captain_id = captains.id
    );
  `;

  const resetWinners = `
    delete from winners
    where exists (
      select 1
      from captains
      inner join users on captains.user_id = users.id
      where server_id = ${server_id} and winners.captain_id = captains.id
    );
  `;

  const resetBets = `
    delete from bets
    where exists (
      select 1
      from users
      where server_id = ${server_id} and bets.user_id = users.id
    );
  `;

  await pool.query(resetTies);
  await pool.query(resetWinners);
  await pool.query(resetBets);
  return;
}

module.exports = {
  getChannels,
  getAllUsers,
  createMoney,
  createUser,
  getCaptains,
  getUser,
  setUsersMoney,
  createBet,
  openBetting,
  closeBetting,
  isBettingOpen,
  getAllBets,
  updateCurrency,
  updateUsername,
  getAdmin,
  createCaptain,
  deleteCaptains,
  createAdmin,
  deleteAdmins,
  createWinner,
  deleteWinner,
  getWinners,
  createTie,
  getTies,
  deleteTie,
  updateUsersMoney,
  getBettingResults,
  resetBetting,
  getAllUsersWithBets
}
