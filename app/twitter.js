'use strict';

/**
 * Twitter API module
 * Fetches user profile + media posts via Twitter's internal GraphQL API.
 * Auth via Chrome cookies (macOS only — reads from Chrome Keychain + SQLite DB).
 *
 * Query IDs change when Twitter updates their web app.
 * If fetches fail: open Chrome DevTools on x.com, filter Network by "graphql",
 * find UserByScreenName / UserMedia requests and copy the IDs from the URL.
 */

const { execFileSync } = require('child_process');
const { copyFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { tmpdir, homedir } = require('os');
const { pbkdf2Sync, createDecipheriv, randomUUID } = require('crypto');
const https = require('https');

// Public bearer token — same for all clients
const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const GQL_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

// ─── Chrome cookie extraction ─────────────────────────────────────────────────

function getChromeKey() {
  const candidates = [
    ['Chrome Safe Storage', 'Chrome'],
    ['Chrome Safe Storage', 'Google Chrome'],
    ['Google Chrome Safe Storage', 'Chrome'],
    ['Google Chrome Safe Storage', 'Google Chrome'],
  ];
  for (const [service, account] of candidates) {
    try {
      const pw = execFileSync(
        'security',
        ['find-generic-password', '-w', '-s', service, '-a', account],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (pw) return pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
    } catch {}
  }
  throw new Error(
    'Could not read Chrome Safe Storage key from Keychain.\n' +
    'Make sure Google Chrome is installed and you are logged into x.com.'
  );
}

function getTwitterCookies() {
  const dbPath = join(homedir(), 'Library/Application Support/Google/Chrome/Default/Cookies');
  const key = getChromeKey();
  const tmp = join(tmpdir(), `twp-${randomUUID()}.db`);

  copyFileSync(dbPath, tmp);

  let dbVersion = 0;
  try {
    dbVersion =
      parseInt(
        execFileSync('sqlite3', [tmp, "SELECT value FROM meta WHERE key='version';"], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
      ) || 0;
  } catch {}

  const sql = `SELECT name, hex(encrypted_value) AS h, value FROM cookies
               WHERE host_key LIKE '%.x.com' AND name IN ('ct0','auth_token');`;
  const rows = JSON.parse(
    execFileSync('sqlite3', ['-json', tmp, sql], { encoding: 'utf8' }).trim() || '[]'
  );
  unlinkSync(tmp);

  const dec = new Map();
  for (const r of rows) {
    if (r.h) {
      const buf = Buffer.from(r.h, 'hex');
      if (buf[0] === 0x76 && buf[1] === 0x31 && buf[2] === 0x30) {
        const iv = Buffer.alloc(16, 0x20);
        const cipher = createDecipheriv('aes-128-cbc', key, iv);
        let p = Buffer.concat([cipher.update(buf.subarray(3)), cipher.final()]);
        if (dbVersion >= 24 && p.length > 32) p = p.subarray(32);
        dec.set(r.name, p.toString('utf8').replace(/\0+$/, '').trim());
      }
    } else if (r.value) {
      dec.set(r.name, r.value);
    }
  }

  const ct0 = dec.get('ct0');
  if (!ct0) {
    throw new Error(
      'No ct0 cookie found. Make sure you are logged into x.com in Google Chrome.'
    );
  }
  return { csrfToken: ct0, cookieHeader: `ct0=${ct0}; auth_token=${dec.get('auth_token')}` };
}

// ─── HTTPS request (replaces curl) ───────────────────────────────────────────

function get(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(
              new Error(`Twitter API HTTP ${res.statusCode} — ${body.slice(0, 300)}`)
            );
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

// ─── GraphQL wrapper ──────────────────────────────────────────────────────────

async function gql(queryId, operation, variables, fieldToggles) {
  const { csrfToken, cookieHeader } = getTwitterCookies();
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(GQL_FEATURES),
  });
  if (fieldToggles) params.set('fieldToggles', JSON.stringify(fieldToggles));

  return get(`https://x.com/i/api/graphql/${queryId}/${operation}?${params}`, {
    authorization: `Bearer ${BEARER}`,
    'x-csrf-token': csrfToken,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    cookie: cookieHeader,
  });
}

// ─── Tweet parser ─────────────────────────────────────────────────────────────

function parseTweet(result, fallbackHandle) {
  const tweet = result?.tweet ?? result;
  const legacy = tweet?.legacy;
  if (!legacy) return null;

  const id = legacy.id_str ?? tweet?.rest_id;
  if (!id) return null;

  const handle =
    tweet?.core?.user_results?.result?.legacy?.screen_name || fallbackHandle;

  const media =
    legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  if (!media.length) return null;

  return {
    id,
    text: legacy.full_text ?? '',
    url: `https://x.com/${handle}/status/${id}`,
    postedAt: legacy.created_at ?? '',
    images: media.map((m) => {
      const item = {
        url: m.media_url_https,
        width: m.original_info?.width ?? m.sizes?.large?.w ?? 1,
        height: m.original_info?.height ?? m.sizes?.large?.h ?? 1,
        type: m.type || 'photo',
      };
      // For video / animated_gif — pick the highest-bitrate MP4 variant
      if (m.video_info?.variants) {
        const mp4s = m.video_info.variants
          .filter(v => v.content_type === 'video/mp4' && v.url)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (mp4s.length) item.videoUrl = mp4s[0].url;
      }
      return item;
    }),
    likeCount: legacy.favorite_count ?? 0,
    repostCount: legacy.retweet_count ?? 0,
    bookmarkCount: legacy.bookmark_count ?? 0,
  };
}

function extractTweets(result, handle) {
  const tw =
    result.__typename === 'TweetWithVisibilityResults'
      ? parseTweet(result.tweet, handle)
      : parseTweet(result, handle);
  return tw ? [tw] : [];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {string} handle
 * @param {number} maxPosts
 * @param {function} onProgress
 * @param {string|null} fromCursor  — resume pagination from this cursor (for "load more")
 * @param {string|null} knownUserId — skip profile fetch if userId is already cached
 */
async function fetchUserData(handle, maxPosts = 200, onProgress = () => {}, fromCursor = null, knownUserId = null) {
  // 1. Profile (skipped for load-more when userId is already known)
  let profile = null;
  let userId = knownUserId;

  if (!userId) {
  onProgress({ stage: 'profile', message: 'Looking up profile...' });
  const userJson = await gql('NimuplG1OB7Fd2btCLdBOw', 'UserByScreenName', {
    screen_name: handle,
    withSafetyModeUserFields: true,
  });

  const userResult = userJson?.data?.user?.result;
  userId = userResult?.rest_id; // assign to outer let
  if (!userId) {
    const msg = userJson?.errors?.map((e) => e.message).join(', ');
    throw new Error(
      msg || 'User not found. Check the handle, or the GraphQL query ID may have changed.'
    );
  }

  const ul = userResult.legacy;
  profile = {
    name: ul?.name || handle,
    handle,
    bio: (ul?.description || '').slice(0, 200),
    avatar: ul?.profile_image_url_https?.replace('_normal', '_400x400') || '',
    banner: ul?.profile_banner_url || '',
    url: `https://x.com/${handle}`,
    followersCount: ul?.followers_count || 0,
    followingCount: ul?.friends_count || 0,
    tweetsCount: ul?.statuses_count || 0,
  };
  } // end if (!userId)

  // 2. Media timeline
  const tweets = [];
  let cursor = fromCursor; // start from given cursor for load-more
  let lastSeenCursor = fromCursor;
  let page = 0;

  while (tweets.length < maxPosts) {
    page++;
    onProgress({ stage: 'fetch', page, total: tweets.length, maxPosts });

    const vars = {
      userId,
      count: 20,
      includePromotedContent: false,
      withClientEventToken: false,
      withBirdwatchNotes: false,
      withVoice: true,
      withV2Timeline: true,
    };
    if (cursor) vars.cursor = cursor;

    let json;
    try {
      json = await gql('y4E0HTZKPhAOXewRMqMqgw', 'UserMedia', vars, {
        withArticlePlainText: false,
      });
    } catch (e) {
      console.error(`[twitter] page ${page} error:`, e.message);
      break;
    }

    const instructions =
      json?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
      json?.data?.user?.result?.timeline?.timeline?.instructions ??
      [];

    let added = 0;
    let nextCursor = null;

    for (const instr of instructions) {
      // First page entries
      if (instr.type === 'TimelineAddEntries' || instr.entries) {
        for (const entry of instr.entries ?? []) {
          // Module entries (media grid grouping)
          if (entry.content?.items) {
            for (const item of entry.content.items) {
              const r = item.item?.itemContent?.tweet_results?.result;
              if (r) { tweets.push(...extractTweets(r, handle)); added++; }
            }
          }
          // Single tweet entries
          const r = entry.content?.itemContent?.tweet_results?.result;
          if (r) { tweets.push(...extractTweets(r, handle)); added++; }
          // Cursor
          if (entry.content?.cursorType === 'Bottom' || entry.entryId?.startsWith('cursor-bottom')) {
            nextCursor = entry.content?.value;
          }
        }
      }
      // Subsequent pages (TimelineAddToModule)
      if (instr.type === 'TimelineAddToModule') {
        for (const item of instr.moduleItems ?? []) {
          const r = item.item?.itemContent?.tweet_results?.result;
          if (r) { tweets.push(...extractTweets(r, handle)); added++; }
        }
      }
    }

    // Cursor fallback
    if (!nextCursor) {
      for (const instr of instructions) {
        if (instr.type === 'TimelineAddEntries') {
          for (const entry of instr.entries ?? []) {
            if (entry.content?.cursorType === 'Bottom' || entry.entryId?.startsWith('cursor-bottom')) {
              nextCursor = entry.content?.value;
            }
          }
        }
      }
    }

    if (nextCursor) lastSeenCursor = nextCursor;
    if (!nextCursor || added === 0) break;
    cursor = nextCursor;
  }

  // Deduplicate + sort
  const seen = new Set();
  const unique = tweets.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  unique.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
  const posts = unique.slice(0, maxPosts);

  // If we stopped because maxPosts was reached (not because we ran out of pages),
  // lastSeenCursor is the next page cursor the caller can use for "load more".
  const ranOut = tweets.length < maxPosts;
  const nextCursorForCaller = ranOut ? null : lastSeenCursor;

  onProgress({ stage: 'done', total: posts.length });

  return {
    profile,      // null when called with knownUserId (load-more skips profile)
    posts,
    hiddenIds: [],
    fetchedAt: new Date().toISOString(),
    nextCursor: nextCursorForCaller,
    hasMore: !!nextCursorForCaller,
    userId: userId || null,
  };
}

module.exports = { fetchUserData };
