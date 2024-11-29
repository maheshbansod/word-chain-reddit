import './createPost.js';

import { Devvit, useChannel, useState, Context, useAsync, useForm } from '@devvit/public-api';
  
type WordChainPostMessage = {
  type: 'joinGame';
  data: { username: string };
  }
  | {
      type: 'startGame';
      data: { letter: string; currentTurn: string };
    }
  | {
      type: 'leaveGame';
      data: { username: string };
    }
  | {
    type: 'addWord';
    data: { word: string };
  };

enum PostStateType {
  Lobby,
  Playing,
  Ended,
}

type PostState = {
  type: PostStateType.Lobby;
} | {
  type: PostStateType.Playing;
  letter: string;
  currentTurn: string;
  initWordsSoFar: string[];
} | {
  type: PostStateType.Ended;
}

Devvit.configure({
  redditAPI: true,
  realtime: true,
  redis: true,
});

// Add a custom post type to Devvit
Devvit.addCustomPostType({
  name: 'Webview Example',
  height: 'tall',
  render: (context) => {
    const { data: username, loading: usernameLoading } = useAsync(async () => {
      const currUser = await context.reddit.getCurrentUser();
      return currUser?.username ?? 'anon';
    });

    const { data: initialPostState, loading: initialPostStateLoading } = useAsync(async () => {
      const redisPostState = await context.redis.get(`postState_${context.postId}`);
      try {
        if (!redisPostState) {
          return { type: PostStateType.Lobby } as const;
        }
        const parsed = JSON.parse(redisPostState) as PostState;
        if (parsed.type === PostStateType.Playing) {
          const redisWordsSoFar = await context.redis.get(`wordsSoFar_${context.postId}`);
          const redisCurrentTurn = await context.redis.get(`currentTurn_${context.postId}`);
          parsed.initWordsSoFar = JSON.parse(redisWordsSoFar ?? "[]") as string[];
          parsed.currentTurn = redisCurrentTurn ?? 'a_cube_root_of_one';
        }
        return parsed;
      } catch (e) {
        return { type: PostStateType.Lobby } as const;
      }
    });

    const { data: players, loading: playersLoading } = useAsync(async () => {
      return await getPlayers();
    });

    async function getPlayers() {
      const redisPlayers = await context.redis.get(`players_${context.postId}`);
      if (!redisPlayers) {
        return [];
      }
      return JSON.parse(redisPlayers) as string[];
    }

    const isLoading = usernameLoading || initialPostStateLoading || playersLoading;

    return <vstack>
      {isLoading && <text>Loading...</text>}
      {!isLoading && <Game context={context} initialPlayers={players!} playersGetter={getPlayers} username={username!} initialPostState={initialPostState!} />}
    </vstack>
  }});

type GameParams = {
  context: Context;
  initialPlayers: string[];
  playersGetter: () => Promise<string[]>;
  username: string;
  initialPostState: PostState;
}

function Game({ context, initialPlayers, playersGetter, username, initialPostState }: GameParams) {

  const [players, setPlayers] = useState<string[]>(initialPlayers);
  const [postState, setPostState] = useState<PostState>(initialPostState);

  const channel = useChannel<WordChainPostMessage>({
    name: 'word_chain_post',
    onMessage: (msg) => {
      switch (msg.type) {
        case 'leaveGame':
          setPlayers(players.filter(player => player !== msg.data.username));
          break;
        case 'joinGame':
          // todo: set max players maybe + basic validation
          setPlayers([...players, msg.data.username]);
          break;
        case 'startGame':
          if (players[0] === username && players.length > 1) {
            const letter = msg.data.letter;
            const currentTurn = msg.data.currentTurn;
            setPostState({ type: PostStateType.Playing, letter, currentTurn, initWordsSoFar: [] });
          } else {
            // todo: show error
          }
          break;
        case 'addWord':
          break;
        default:
          throw new Error(`Unknown message type: ${msg satisfies never}`);
      }
    },
  });

  channel.subscribe();


  const onStartGameClick = async () => {
    // todo: validation maybe 
    const randomLetter = String.fromCharCode(Math.floor(Math.random() * 26) + 'A'.charCodeAt(0));
    const randomTurn = players[Math.floor(Math.random() * players.length)];
    setPostState({ type: PostStateType.Playing, letter: randomLetter, currentTurn: randomTurn, initWordsSoFar: [] });
    channel.send({ type: 'startGame', data: { letter: randomLetter, currentTurn: randomTurn } });
    await context.redis.set(`postState_${context.postId}`, JSON.stringify({ type: PostStateType.Playing, letter: randomLetter, currentTurn: randomTurn }));
    await context.redis.set(`currentTurn_${context.postId}`, randomTurn);
    await context.redis.set(`wordsSoFar_${context.postId}`, JSON.stringify([]));
  };

  const onJoinGameClick = async () => {
    console.log("joining game now");
    setPlayers([...players, username]);
    await context.redis.set(`players_${context.postId}`, JSON.stringify([...players, username]));
    channel.send({ type: 'joinGame', data: { username } });
    console.log("joined game now");
  };

  const onLeaveGameClick = async () => {
    setPlayers(players.filter(player => player !== username));
    await context.redis.set(`players_${context.postId}`, JSON.stringify(players.filter(player => player !== username)));
    channel.send({ type: 'leaveGame', data: { username } });
  };

  if (postState.type === PostStateType.Lobby) {
    const isJoined = players.includes(username);
    return <>
      <text size="large">Waiting for players to join...</text>
      <hstack>
        <text size="medium">Players:</text>
        <vstack>
          {players.map(player => 
            <text size="medium" weight="bold">{player}</text>
        )}
        </vstack>
      </hstack>
      {players.length > 1 && players[0] === username && <button onPress={onStartGameClick}>Start game</button>}
      {!isJoined && <button onPress={onJoinGameClick}>Join game</button>}
      {isJoined && <button onPress={onLeaveGameClick}>Leave game</button>}
    </>
  };

  if (postState.type === PostStateType.Playing) {
    const moveTurn = () => {
      const nextTurn = players[(players.indexOf(postState.currentTurn) + 1) % players.length];  
      setPostState({ ...postState, currentTurn: nextTurn });
    }
    return <GamePlay context={context} gamePlayData={postState} username={username} players={players} moveTurn={moveTurn} />
  }

  return <text>hello {postState.type}</text>

}


export default Devvit;

type GamePlayParams = {
  context: Context;
  gamePlayData: {
    letter: string;
    currentTurn: string;
    initWordsSoFar: string[];
  };
  players: string[];
  username: string;
  moveTurn: () => void;
}

type GamePlayMessage = {
  type: 'addWord';
  data: { word: string };
}

function GamePlay({ context, gamePlayData, username, players, moveTurn }: GamePlayParams) {
  const { letter, currentTurn, initWordsSoFar } = gamePlayData;
  const nextTurn = players[(players.indexOf(currentTurn) + 1) % players.length];

  const [wordsSoFar, setWordsSoFar] = useState<string[]>(initWordsSoFar);

  const isCurrentTurn = currentTurn === username;

  const channel = useChannel<GamePlayMessage>({
    name: 'word_chain_gameplay',
    onMessage: (msg) => {
      if (msg.type === 'addWord') {
        if (currentTurn !== username) {
          setWordsSoFar([...wordsSoFar, msg.data.word]);
        }
        moveTurn();
      } else {
        throw new Error(`Unknown message type: ${msg}`);
      }
    },
  });
  
  channel.subscribe();

  const wordForm = useForm({
    fields: [
      {
        type: 'string',
        name: 'word',
        label: `Your word starting with ${letter}`,
      }
    ],
  }, values => {
    const word = values.word;
    if (!word) {
      // todo: show error
      return;
    }
    channel.send({ type: 'addWord', data: { word } });
    context.redis.set(`wordsSoFar_${context.postId}`, JSON.stringify([...wordsSoFar, word]));
    context.redis.set(`currentTurn_${context.postId}`, nextTurn);
    setWordsSoFar([...wordsSoFar, word]);
  });

  const onAddWordClick = async () => {
    context.ui.showForm(wordForm);
  };

  return <>
    <text size="large">Current letter: {letter}</text>
    <text size="large">Next turn: {nextTurn}</text>
    <text size="large">Words so far:</text>
    <vstack>
      {wordsSoFar.map(word => <text size="medium">{word}</text>)}
    </vstack>

    {isCurrentTurn && <button onPress={onAddWordClick}>Add word</button>}
  </>
}
