import './createPost.js';

import { Devvit, useChannel, useState, Context, useAsync, useForm, useInterval } from '@devvit/public-api';
import { PostState, PostStateType, WordSoFar } from './types.js';
  
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

  type UserData = {
    username: string;
    snoovatarUrl: string;
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
    const { data: userData, loading: usernameLoading } = useAsync(async () => {
      const currUser = await context.reddit.getCurrentUser();
      const snoovatarUrl = await currUser?.getSnoovatarUrl();
      return { username: currUser?.username ?? 'anon', snoovatarUrl: snoovatarUrl ?? '' };
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
      {!isLoading && <Game context={context} initialPlayers={players!} playersGetter={getPlayers} userData={userData!} initialPostState={initialPostState!} />}
    </vstack>
  }});

type GameParams = {
  context: Context;
  initialPlayers: string[];
  playersGetter: () => Promise<string[]>;
  userData: UserData;
  initialPostState: PostState;
}

function Game({ context, initialPlayers, playersGetter, userData, initialPostState }: GameParams) {
  const { username, snoovatarUrl } = userData;
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
    await context.redis.set(`lostPlayers_${context.postId}`, JSON.stringify([]));
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
    return  (<vstack grow padding="small">
      <hstack alignment="middle" height="30px">
        <text size="xxlarge" alignment="center">Word chain!</text>
        <spacer grow />
        {isJoined && <button appearance="destructive" onPress={onLeaveGameClick}>Leave game</button>}
      </hstack>
      {players.length === 0 && <vstack grow alignment="center middle"><text size="large">Waiting for players to join...</text></vstack>}
      {players.length > 0 && <vstack grow gap="small">
          <spacer />
          {players.map(player => <hstack border="thick" borderColor="green" padding="small" cornerRadius="small" alignment='middle'>
            <icon name="admin-fill" color="red" />
            <spacer />
            <text size="medium" weight="bold">u/{player}</text>
            {players[0] !== username && player === username && <>
              <spacer />
              <icon name="joined-fill" color="green" />
            </>}
            {players[0] === player && <>
              <spacer/>
              <icon name="mod" color="blue"/>
            </>}
          </hstack>
        )}
      </vstack>}
      {players.length > 1 && players[0] === username && <button appearance="primary" onPress={onStartGameClick}>Start game</button>}
      {!isJoined && <button appearance="primary" onPress={onJoinGameClick}>Join game</button>}
    </vstack>)
  };

  if (postState.type === PostStateType.Playing) {

    function getActivePlayers() {
      return 'lostPlayers' in postState ? players.filter(player => !postState.lostPlayers.includes(player)) : [];
    }
    const activePlayers = getActivePlayers();
    const moveTurn = () => {
      const nextTurn = activePlayers[(activePlayers.indexOf(postState.currentTurn) + 1) % activePlayers.length];  
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
    const addLostPlayer = (player: string) => {
      setPostState({ ...postState, lostPlayers: [...postState.lostPlayers, player] });
      if (players[0] === username) {
        context.redis.set(`lostPlayers_${context.postId}`, JSON.stringify([...postState.lostPlayers, player]));
      }
      if (activePlayers.length === 2) { // we check 2 since the state will update on the re-render
        // the game has ended
        // let's make a leaderboard
        // basically lost players are added in the sequence that they lost, so we can just reverse that.
        const lostPlayers = [...postState.lostPlayers];
        lostPlayers.reverse();
        // `player` is the one who lost last
        const playerWhoLostLast = player;
        const winner = activePlayers.filter(player => player !== playerWhoLostLast)[0];
        const leaderboard = [winner, playerWhoLostLast, ...lostPlayers];
        context.redis.get(`wordsSoFar_${context.postId}`).then(wordsSoFarRaw => {
          const wordsSoFar = JSON.parse(wordsSoFarRaw ?? "[]") as WordSoFar[];
          setPostState({ type: PostStateType.Ended, leaderboard, words: wordsSoFar });
          if (players[0] === username) {
            context.redis.set(`postState_${context.postId}`, JSON.stringify({ type: PostStateType.Ended, leaderboard, words: wordsSoFar })).catch(() => {});
          }
        });
        return true;
      }
      return false;
    };
    return <vstack grow={true}>
      <GamePlay context={context} gamePlayData={postState} username={username} players={activePlayers} moveTurn={moveTurn} addLostPlayer={addLostPlayer} leaveGame={leaveGame} />
      {/* <button onPress={clearWordsSoFar}>Clear words so far</button> */}
    </vstack>
  }

  const placeEmoji = postState.leaderboard.indexOf(username) === 0 ? '🏆' : postState.leaderboard.indexOf(username) === 1 ? '🥈' : postState.leaderboard.indexOf(username) === 2 ? '🥉' : '';
  // st, nd, rd, th
  const placePrefix = postState.leaderboard.indexOf(username) === 0 ? 'st' : postState.leaderboard.indexOf(username) === 1 ? 'nd' : postState.leaderboard.indexOf(username) === 2 ? 'rd' : 'th';
  
  const longestWord = postState.words.reduce((longest, word) => word.word.length > longest.word.length ? word : longest, postState.words[0]);


  // Game ended state
  return <vstack grow={true} padding="small">
  <text size="xxlarge" alignment="center">Leaderboard</text>
  <spacer />
  <hstack>
    <vstack gap="small" width="50%">
      {postState.leaderboard.map((player, i) => <hstack border={player === username ? 'thick' : 'thin'} padding="small" cornerRadius="small" gap="small" borderColor={player === username ? 'skyblue': undefined}>
        <text size="large" weight="bold">#{i + 1}</text>
        <text size="large">{player}</text>
        <spacer grow />
        {i == 0 && <icon name="contest-fill" color="gold" />}
        {i == 1 && <icon name="contest-fill" color="silver" />}
        {i == 2 && <icon name="contest-fill" color="brown" />}
      </hstack>)}
    </vstack>
    <vstack width="50%" padding='small'>
      <text size="large">You finished in {placeEmoji} {postState.leaderboard.indexOf(username) + 1}{placePrefix} place</text>
      <spacer />
      <text>There were a total of {postState.words.length} words!</text>
      <text>Longest word was {longestWord.word.length} letters long by {longestWord.by}: {longestWord.word}</text>
    </vstack>
  </hstack>
  <spacer grow />
  {/* {username === players[0] && <button appearance="secondary">Back to lobby</button>} */}
</vstack>

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
  addLostPlayer: (player: string) => boolean;
  leaveGame: () => void;
}

type GamePlayMessage = {
  type: 'addWord';
  data: { word: string; timestamp: number };
} | {
  type: 'timesUp';
}

function GamePlay({ context, gamePlayData, username, players, moveTurn, addLostPlayer, leaveGame }: GamePlayParams) {
  const { letter:initialLetter, currentTurn, initWordsSoFar } = gamePlayData;
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

        const isGameOver = addLostPlayer(currentTurn);
        if (isGameOver) {
          return;
        }
        if (players[0] === username) {

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
    
    context.redis.set(`wordsSoFar_${context.postId}`, JSON.stringify([...wordsSoFar, {by: username, word, timestamp: Date.now()}]));
    context.redis.set(`currentTurn_${context.postId}`, nextTurn);
  }

  const onAddWordClick = async () => {
    context.ui.showForm(wordForm);
  };

  const maxWords = 7;

  const limitedWordsSoFar = wordsSoFar.length > maxWords ? wordsSoFar.slice(wordsSoFar.length - maxWords) : wordsSoFar;

  return <vstack padding="small" grow={true}>
    <hstack width='100%'>
      <vstack width='33%' alignment='middle start'>
        <hstack border='thick' padding='small' cornerRadius='full'>
          {wordsSoFar.length === 0 && <>
            <spacer/>
            <text size="xxlarge">READY</text>
            <spacer/>
          </>}
          {wordsSoFar.length > 0 && <text size="xxlarge" width="30px" alignment="center">
            {timerValueSeconds}
          </text>}
        </hstack>
      </vstack>
      <vstack width='33%' alignment='middle center' backgroundColor={isCurrentTurn ? 'red' : 'blue'} cornerRadius='small'>
        <text size="xxlarge" weight='bold' color='white' >
          {letter}
        </text>
      </vstack>
      <vstack width='33%' alignment='end'>
        <text size='medium'>Next</text>
        <text size="large" weight='bold'>{nextTurn}</text>
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
    <text alignment='center'>Waiting for {currentTurn} to add a word...</text>
    <spacer grow={true} />
    {isCurrentTurn && <button onPress={onAddWordClick}>Add word</button>}
    {/* <button onPress={leaveGame}>End game</button> */}
  </vstack>
}
