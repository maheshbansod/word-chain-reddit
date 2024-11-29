import './createPost.js';

import { Devvit, useChannel, useState, Context, useAsync, useForm, useInterval } from '@devvit/public-api';
  
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
  initWordsSoFar: WordSoFar[];
  lostPlayers: string[];
} | {
  type: PostStateType.Ended;
}

Devvit.configure({
  redditAPI: true,
  realtime: true,
  redis: true,
});

Devvit.addSchedulerJob({
  name: 'countdownTimer',
  onRun: async (event, context) => {
    context.realtime.send('word_chain_gameplay', { type: 'timesUp' });
  }
})

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
          const redisLostPlayers = await context.redis.get(`lostPlayers_${context.postId}`);
          parsed.initWordsSoFar = JSON.parse(redisWordsSoFar ?? "[]") as WordSoFar[];
          parsed.lostPlayers = JSON.parse(redisLostPlayers ?? "[]") as string[];
          parsed.currentTurn = redisCurrentTurn ?? '';
          const redisLetter = await context.redis.get(`letter_${context.postId}`);
          parsed.letter = redisLetter ?? 'A';
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


    return <vstack grow={true}>
      {isLoading && <text>Loading game...</text>}
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
          if (username !== msg.data.username) {
            setPlayers([...players, msg.data.username]);
          }
          break;
        case 'startGame':
          if (players.length > 1) {
            const letter = msg.data.letter;
            const currentTurn = msg.data.currentTurn;
            setPostState({ type: PostStateType.Playing, letter, currentTurn, initWordsSoFar: [], lostPlayers: [] });
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
    setPostState({ type: PostStateType.Playing, letter: randomLetter, currentTurn: randomTurn, initWordsSoFar: [], lostPlayers: [] });
    channel.send({ type: 'startGame', data: { letter: randomLetter, currentTurn: randomTurn } });
    await context.redis.set(`postState_${context.postId}`, JSON.stringify({ type: PostStateType.Playing, letter: randomLetter, currentTurn: randomTurn }));
    await context.redis.set(`currentTurn_${context.postId}`, randomTurn);
    await context.redis.set(`wordsSoFar_${context.postId}`, JSON.stringify([]));
  };

  const onJoinGameClick = async () => {
    setPlayers([...players, username]);
    await context.redis.set(`players_${context.postId}`, JSON.stringify([...players, username]));
    channel.send({ type: 'joinGame', data: { username } });
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
    };
    const leaveGame = async () => {
      setPostState({ type: PostStateType.Lobby });
      await context.redis.set(`postState_${context.postId}`, JSON.stringify({ type: PostStateType.Lobby }));
    };
    const clearWordsSoFar = async () => {
      await context.redis.set(`wordsSoFar_${context.postId}`, JSON.stringify([]));
      setPostState({ ...postState, initWordsSoFar: [] });
    };
    return <vstack grow={true}>
      <GamePlay context={context} gamePlayData={postState} username={username} players={players} moveTurn={moveTurn} leaveGame={leaveGame} />
      <button onPress={clearWordsSoFar}>Clear words so far</button>
    </vstack>
  }

  return <text>hello {postState.type}</text>

}


export default Devvit;

type GamePlayParams = {
  context: Context;
  gamePlayData: {
    letter: string;
    currentTurn: string;
    initWordsSoFar: WordSoFar[];
    lostPlayers: string[];
  };
  players: string[];
  username: string;
  moveTurn: () => void;
  leaveGame: () => void;
}

type GamePlayMessage = {
  type: 'addWord';
  data: { word: string; timestamp: number };
} | {
  type: 'timesUp';
}

type WordSoFar = {
  by: string;
  word: string;
  timestamp: number;
}

function GamePlay({ context, gamePlayData, username, players, moveTurn, leaveGame }: GamePlayParams) {
  const { letter:initialLetter, currentTurn, initWordsSoFar, lostPlayers: initialLostPlayers } = gamePlayData;
  const nextTurn = players[(players.indexOf(currentTurn) + 1) % players.length];
  const [letter, setLetter] = useState(initialLetter);

  const [wordsSoFar, setWordsSoFar] = useState<WordSoFar[]>(initWordsSoFar);

  function getRemainingTime(fromWords: WordSoFar[]) {
    const maxTimeSeconds = 60;
    const lastTimestamp = fromWords.length > 0 ? fromWords[fromWords.length - 1].timestamp : Date.now();
    const timeRemaining = maxTimeSeconds * 1000 - (Date.now() - lastTimestamp);
    return timeRemaining > 0 ? timeRemaining : 0;
  }

  const [timerValue, setTimerValue] = useState(getRemainingTime(initWordsSoFar));

  const timerInterval = useInterval(() => {
    setTimerValue(getRemainingTime(wordsSoFar));
  }, 1000);

  timerInterval.start();

  const isCurrentTurn = currentTurn === username;
  const timerValueSeconds = Math.floor(timerValue / 1000);

  const [removePlayerAlert, setRemovePlayerAlert] = useState<string | null>(null);

  const [lostPlayers, setLostPlayers] = useState<string[]>(initialLostPlayers);

  const channel = useChannel<GamePlayMessage>({
    name: 'word_chain_gameplay',
    onMessage: (msg) => {
      if (msg.type === 'addWord') {
        if (currentTurn !== username) {
          const timestamp = msg.data.timestamp;
          // validation - timestamp should be within some seconds of the current time.
          if (timestamp < Date.now() - 5000) {
            // should throw an error or something maybe? or ban the user?
            return;
          }
          setWordsSoFar([...wordsSoFar, {by: currentTurn, word: msg.data.word, timestamp}]);
          setLetter(nextLetter(msg.data.word));
          setTimerValue(getRemainingTime(wordsSoFar));
        }
        moveTurn();
      } else if (msg.type === 'timesUp') {
        // this means that a user didn't add a word in time
        // so the player loses, and the current turn is over
        // at least one player should update redis on their turn maybe.

        setLostPlayers([...lostPlayers, currentTurn]);
        if (players[0] === username) {
          context.redis.set(`lostPlayers_${context.postId}`, JSON.stringify([...lostPlayers, currentTurn]));

          nextWordTasks('<system> times up');
        }
        moveTurn();
      } else {
        throw new Error(`Unknown message type: ${msg satisfies never}`);
      }
    },
  });

  channel.subscribe();

  function nextLetter(word: string) {
    return word[word.length - 1].toUpperCase();
  }

  const wordForm = useForm({
    fields: [
      {
        type: 'string',
        name: 'word',
        label: `Your word starting with ${letter}`,
      }
    ],
  }, async values => {
    const word = values.word;
    if (!word) {
      // todo: show error
      return;
    }
    nextWordTasks(word);
  });

  async function nextWordTasks(word: string) {
    if (!word.startsWith('<system>')) {
      setWordsSoFar([...wordsSoFar, {by: username, word, timestamp: Date.now()}]);
      setLetter(nextLetter(word));
      context.redis.set(`letter_${context.postId}`, nextLetter(word));
    }
    channel.send({ type: 'addWord', data: { word, timestamp: Date.now() } });
    const currentJobId = await context.redis.get(`countdownTimerJobId_${context.postId}`);
    if (currentJobId) {
      context.scheduler.cancelJob(currentJobId).catch(() => {});
    }

    const newJobId = await context.scheduler.runJob({
      name: 'countdownTimer',
      runAt: new Date(Date.now() + 60000),
    });
    context.redis.set(`countdownTimerJobId_${context.postId}`, newJobId);
    
    context.redis.set(`wordsSoFar_${context.postId}`, JSON.stringify([...wordsSoFar, {by: username, word}]));
    context.redis.set(`currentTurn_${context.postId}`, nextTurn);
  }

  const onAddWordClick = async () => {
    context.ui.showForm(wordForm);
  };

  const maxWords = 7;

  const limitedWordsSoFar = wordsSoFar.slice(0, maxWords);

  return <vstack padding="small" grow={true}>
    <hstack width='100%'>
      <vstack width='33%'>
        <hstack border='thick' padding='small' cornerRadius='full'>
          <text size="xxlarge">
              {timerValueSeconds}
          </text>
        </hstack>
      </vstack>
      <vstack width='33%' alignment='middle center' backgroundColor={isCurrentTurn ? 'red' : 'blue'} cornerRadius='small'>
        <text size="xxlarge" weight='bold' color='white' >
          {letter}
        </text>
      </vstack>
      <vstack width='33%' alignment='end'>
        <text size='medium'>Next</text>
        <text size="large">{nextTurn}</text>
      </vstack>
    </hstack>
    {limitedWordsSoFar.map(word => <vstack alignment={word.by !== username ? 'start' : 'end'}>
      <vstack>
        <text size="small">{word.by === username ? 'You' : word.by}</text>
      </vstack>
      <vstack
        backgroundColor={word.by === username ? 'red' : 'blue'}
        padding="small"
        cornerRadius='medium'
        >
        <text color='white'>{word.word}</text>
      </vstack>
    </vstack>)}
    <spacer grow={true} />
    {lostPlayers.length > 0 && <text>Lost players: {lostPlayers.join(', ')}</text>}
    {isCurrentTurn && <button onPress={onAddWordClick}>Add word</button>}
    <button onPress={leaveGame}>End game</button>
  </vstack>
}
