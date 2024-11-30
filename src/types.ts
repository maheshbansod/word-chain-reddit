

export enum PostStateType {
    Lobby,
    Playing,
    Ended,
  }
  
  export type PostState = {
    type: PostStateType.Lobby;
  } | {
    type: PostStateType.Playing;
    letter: string;
    currentTurn: string;
    initWordsSoFar: WordSoFar[];
    lostPlayers: string[];
  } | {
    type: PostStateType.Ended;
    leaderboard: string[];
    words: WordSoFar[];
  }


export type WordSoFar = {
    by: string;
    word: string;
    timestamp: number;
  }