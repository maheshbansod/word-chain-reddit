import { Devvit } from '@devvit/public-api';
import { PostStateType } from './types.js';

// Configure Devvit's plugins
Devvit.configure({
  redditAPI: true,
  realtime: true,
});

// Adds a new menu item to the subreddit allowing to create a new post
Devvit.addMenuItem({
  label: 'New word chain game',
  location: 'subreddit',
  onPress: async (event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: 'Wordchain',
      subredditName: subreddit.name,
      // The preview appears while the post loads
      preview: (
        <vstack height="100%" width="100%" alignment="middle center">
          <text size="large">Loading ...</text>
        </vstack>
      ),
    });
    ui.showToast({ text: 'Created post!' });
    ui.navigateTo(post);
    context.redis.set(`postState_${post.id}`, JSON.stringify({ type: PostStateType.Lobby })).catch(() => {});
    const user = await reddit.getCurrentUser();
    if (!user) {
      throw new Error('User not found');
    }
    context.redis.set(`players_${post.id}`, JSON.stringify([user!.username])).catch(() => {});
  },
});
