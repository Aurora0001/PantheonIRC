import irc from 'irc';
import marked from 'marked';

const renderer = new marked.Renderer();
renderer.paragraph = (text) => text;
renderer.link = (href, title, text) =>
  `<a target="_blank" href="${href}" title="${title}">${text}</a>`;

renderer.image = (href, title, text) => `![${text}](${href})`;

marked.setOptions({
  renderer,
  gfm: true,
  tables: false,
  breaks: false,
  pedantic: false,
  sanitize: true,
  smartLists: false,
  smartypants: true
});

export const CONNECT_BEGIN = 'CONNECT_BEGIN';
export const DISCONNECT_BEGIN = 'DISCONNECT_BEGIN';
export const CONNECTED = 'CONNECTED';
export const DISCONNECTED = 'DISCONNECTED';
export const CONNECT_ERROR = 'CONNECT_ERROR';
export const DISCONNECT_ERROR = 'DISCONNECT_ERROR';
export const NEW_PRIVMSG = 'NEW_PRIVMSG';
export const NEW_ACTION = 'NEW_ACTION';
export const NEW_NOTICE = 'NEW_NOTICE';
export const JOIN_CHANNEL = 'JOIN_CHANNEL';
export const PART_CHANNEL = 'PART_CHANNEL';
export const KICK_CHANNEL = 'KICK_CHANNEL';
export const ADD_MODE = 'ADD_MODE';
export const REMOVE_MODE = 'REMOVE_MODE';
export const USER_QUIT = 'USER_QUIT';
export const RECEIVE_NAMES = 'RECEIVE_NAMES';
export const NICK_CHANGE = 'NICK_CHANGE';
export const SET_TOPIC = 'SET_TOPIC';
export const SEND_JOIN_CHANNEL = 'SEND_JOIN_CHANNEL';
export const SEND_PART_CHANNEL = 'SEND_PART_CHANNEL';
export const USER_KILLED = 'USER_KILLED';
export const SERVER_ERROR = 'SERVER_ERROR';

// If any of these modes are seen, we need to refresh the names list.
const DISPLAY_MODES = ['q', 'a', 'o', 'h', 'v'];

export function connect(host, port, ssl, _nick, ident, real, defaultChannels) {
  return dispatch => {
    dispatch(connect_start());
    const client = new irc.Client(host, _nick, {
      userName: ident,
      realName: real,
      port,
      autoConnect: false,
      secure: ssl,
      channels: defaultChannels
    });

    const networkId = `${host}:${port}`;

    client.connect(0, () => {
      dispatch(connected(client, networkId));
    });

    client.addListener('netError', (err) => {
      console.log(err);
    });

    client.addListener('message', (nick, to, text, message) => {
      dispatch(new_privmsg(nick, to, text, networkId));
      const notification = new Notification(`${nick} (${to}) said:`, {
        body: text
      });
    });

    client.addListener('action', (nick, to, text, message) => {
      dispatch(new_action(nick, to, text, networkId));
    });

    client.addListener('join', (channel, nick, message) => {
      dispatch(join_channel(channel, nick, nick === client.nick, networkId));
    });

    client.addListener('part', (channel, nick, reason, message) => {
      dispatch(part_channel(channel, nick, reason || 'No reason given.',
               nick === client.nick, networkId));
    });

    client.addListener('kick', (channel, nick, by, reason, message) => {
      dispatch(kick_channel(channel, nick, by, reason, nick === client.nick, networkId));
    });

    client.addListener('notice', (channel, to, text, message) => {
      dispatch(new_notice(channel || host, to, text, networkId));
    });

    client.addListener('topic', (channel, topic, nick, message) => {
      dispatch(set_topic(channel, topic, nick, networkId));
    });

    client.addListener('+mode', (channel, by, mode, argument, message) => {
      dispatch(add_mode(channel, by || host, mode, argument, networkId));
      if (DISPLAY_MODES.indexOf(mode) !== -1) {
        client.send('NAMES', channel);
      }
    });

    client.addListener('-mode', (channel, by, mode, argument, message) => {
      dispatch(remove_mode(channel, by || host, mode, argument, networkId));
      if (DISPLAY_MODES.indexOf(mode) !== -1) {
        client.send('NAMES', channel);
      }
    });

    client.addListener('names', (channel, nicks) => {
      dispatch(receive_names(channel, nicks, networkId));
    });

    client.addListener('nick', (oldnick, newnick, channels, message) => {
      channels.forEach(channel => {
        dispatch(nick_change(oldnick, newnick, channel, networkId));
      });
    });

    client.addListener('quit', (nick, reason, channels, message) => {
      channels.forEach(channel => {
        dispatch(user_quit(nick, reason, channel, networkId));
      });
    });

    client.addListener('ctcp-version', (from, to, message) => {
      client.ctcp(from, '', 'VERSION AuroraIRC v0.1.0');
    });

    client.addListener('kill', (nick, reason, channels, message) => {
      channels.forEach(channel => {
        dispatch(user_killed(nick, reason, channel, networkId));
      });
    });

    client.addListener('error', (reason) => {
      Object.keys(client.chans).forEach(channel => {
        dispatch(server_error(reason.args.join(' '), host, channel, networkId));
      });
    });

    client.conn.addListener('close', (err) => {
      Object.keys(client.chans).forEach(channel => {
        dispatch(disconnected(client.nick, channel,
          err ? 'The server closed the connection due to an error'
          : 'The server closed the connection', networkId));
      });
    });
  };
}

export function send_join_channel(channel, networkId) {
  return (dispatch, getState) => {
    const client = getState().clients[networkId];
    client.join(channel);
    dispatch({
      type: SEND_JOIN_CHANNEL,
      channel,
      network_id: networkId
    });
  };
}

export function send_part_channel(channel, networkId) {
  return (dispatch, getState) => {
    const client = getState().clients[networkId];
    client.part(channel);
    dispatch({
      type: SEND_PART_CHANNEL,
      channel,
      network_id: networkId
    });
  };
}

export function send_privmsg(channel, text, networkId) {
  return (dispatch, getState) => {
    const client = getState().clients[networkId];
    client.say(channel, text);
    dispatch(new_privmsg(client.nick, channel, text, networkId));
  };
}

export function send_action(channel, text, networkId) {
  return (dispatch, getState) => {
    const client = getState().clients[networkId];
    client.action(channel, text);
    dispatch(new_action(client.nick, channel, text, networkId));
  };
}

export function send_raw(command, args, networkId) {
  return (dispatch, getState) => {
    const client = getState().clients[networkId];
    client.send(command, ...args);
  };
}

function set_topic(channel, topic, nick, networkId) {
  return {
    type: SET_TOPIC,
    channel,
    topic,
    nick,
    network_id: networkId
  };
}

function nick_change(oldnick, newnick, channel, networkId) {
  return {
    type: NICK_CHANGE,
    channel,
    oldnick,
    newnick,
    network_id: networkId
  };
}

function receive_names(channel, nicks, networkId) {
  return {
    type: RECEIVE_NAMES,
    channel,
    nicks,
    network_id: networkId
  };
}

function user_quit(nick, reason, channel, networkId) {
  return {
    type: USER_QUIT,
    channel,
    nick,
    reason,
    network_id: networkId
  };
}

function add_mode(channel, by, mode, argument, networkId) {
  return {
    type: ADD_MODE,
    channel,
    by,
    mode,
    argument,
    network_id: networkId
  };
}

function remove_mode(channel, by, mode, argument, networkId) {
  return {
    type: REMOVE_MODE,
    channel,
    by,
    mode,
    argument,
    network_id: networkId
  };
}

function new_notice(sender, to, text, networkId) {
  return {
    type: NEW_NOTICE,
    sender,
    to,
    text,
    network_id: networkId
  };
}

function join_channel(channel, nick, self, networkId) {
  return {
    type: JOIN_CHANNEL,
    channel,
    nick,
    network_id: networkId,
    self
  };
}

function kick_channel(channel, nick, by, reason, self, networkId) {
  return {
    type: KICK_CHANNEL,
    channel,
    nick,
    by,
    reason,
    self,
    network_id: networkId
  };
}

function part_channel(channel, nick, reason, self, networkId) {
  return {
    type: PART_CHANNEL,
    channel,
    nick,
    reason,
    self,
    network_id: networkId
  };
}

function new_privmsg(nick, to, text, networkId) {
  return {
    type: NEW_PRIVMSG,
    nick,
    to,
    text: marked(text),
    network_id: networkId
  };
}

function new_action(nick, to, text, networkId) {
  return {
    type: NEW_ACTION,
    nick,
    to,
    text,
    network_id: networkId
  };
}

function connect_start() {
  return {
    type: CONNECT_BEGIN
  };
}

function connected(client, networkId) {
  return {
    type: CONNECTED,
    client,
    network_id: networkId
  };
}

function user_killed(nick, reason, channel, networkId) {
  return {
    type: USER_KILLED,
    channel,
    nick,
    reason,
    network_id: networkId
  };
}

function disconnected(nick, channel, message, networkId) {
  return {
    type: DISCONNECTED,
    message,
    network_id: networkId,
    nick,
    channel
  };
}

function server_error(message, server, channel, networkId) {
  return {
    type: SERVER_ERROR,
    message,
    network_id: networkId,
    server,
    channel
  };
}
