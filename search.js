// ============================================================
//  CreatorIndex: ASMR World — Search Engine
//  File: search.js
//  Place this file in your asmr-app/ folder
// ============================================================

const API_KEY = 'AIzaSyAoQMvf9zcG4BgbTNtVnygerxbVC0-ec-4'; // 🔑 Paste your API key here

// ============================================================
//  CATEGORY SEARCH TERMS
// ============================================================

const CATEGORIES = {
  softspoken:  'soft spoken ASMR',
  whispering:  'whispering ASMR',
  roleplay:    'ASMR roleplay',
  scratching:  'scratching ASMR',
  tapping:     'tapping ASMR',
  reiki:       'reiki ASMR',
  nature:      'nature sounds ASMR',
  shorts:      'ASMR #shorts'
};

// ============================================================
//  TIER DEFINITIONS
// ============================================================

const TIERS = [
  { name: 'Fan Favourites', min: 550000,  max: Infinity },
  { name: 'Established',    min: 200000,  max: 549999   },
  { name: 'Mid Tier',       min: 50000,   max: 199999   },
  { name: 'Hidden Gems',    min: 10000,   max: 49999    },
  { name: 'Rising Stars',   min: 0,       max: 9999     }
];

// ============================================================
//  FORMAT HELPERS
// ============================================================

function formatNumber(count) {
  if (count >= 1000000000) return (count / 1000000000).toFixed(1) + 'B';
  if (count >= 1000000)    return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000)       return (count / 1000).toFixed(1) + 'K';
  return count.toString();
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function daysAgo(dateStr) {
  const uploaded = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now - uploaded) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

function getTier(subscriberCount) {
  return TIERS.find(t => subscriberCount >= t.min && subscriberCount <= t.max) || TIERS[4];
}

// ============================================================
//  DURATION PARSER
//  Converts ISO 8601 duration (PT4M13S) to total seconds
// ============================================================

function parseDuration(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours   = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseInt(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

// ============================================================
//  MOMENTUM CALCULATOR
//  Calculates views per day since upload
//  Compares against tier averages to determine signal
//  Returns: { signal, label, arrow }
// ============================================================

function getMomentum(views, publishedAt, allVideosInTier) {
  const uploaded = new Date(publishedAt);
  const now = new Date();
  const ageInDays = Math.max((now - uploaded) / (1000 * 60 * 60 * 24), 0.5);
  const viewsPerDay = views / ageInDays;

  // Calculate average views/day across all videos in this tier
  const avgViewsPerDay = allVideosInTier.reduce((sum, v) => {
    const age = Math.max((now - new Date(v.publishedAt)) / (1000 * 60 * 60 * 24), 0.5);
    return sum + (v.views / age);
  }, 0) / (allVideosInTier.length || 1);

  const ratio = viewsPerDay / (avgViewsPerDay || 1);

  if (ratio >= 1.4) return { signal: 'accelerating', label: 'Accelerating', arrow: '↑' };
  if (ratio >= 0.7) return { signal: 'holding',      label: 'Holding',      arrow: '→' };
  return               { signal: 'slowing',      label: 'Slowing',      arrow: '↓' };
}

// ============================================================
//  CORE: SEARCH VIDEOS BY CATEGORY
//  Filters out Shorts (under 61 seconds) by default
//  Pass includeShorts=true for the Shorts page
// ============================================================

async function searchCategoryVideos(categoryKey, daysBack = 7, maxResults = 50, includeShorts = false) {
  const query = CATEGORIES[categoryKey];
  if (!query) {
    console.error(`Unknown category: ${categoryKey}`);
    return [];
  }

  const publishedAfter = new Date();
  publishedAfter.setDate(publishedAfter.getDate() - daysBack);
  const publishedAfterISO = publishedAfter.toISOString();

  // Step 1: Search for recent videos
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&order=viewCount&publishedAfter=${publishedAfterISO}&maxResults=${maxResults}&key=${API_KEY}`;

  try {
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();

    if (!searchData.items || searchData.items.length === 0) {
      console.warn(`No videos found for category: ${categoryKey}`);
      return [];
    }

    // Step 2: Get video statistics AND contentDetails (for duration)
    const videoIds = searchData.items.map(item => item.id.videoId).join(',');
    const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${API_KEY}`;
    const videoResponse = await fetch(videoUrl);
    const videoData = await videoResponse.json();

    if (!videoData.items) return [];

    // Step 3: Filter Shorts or long-form depending on page
const filtered = videoData.items.filter(video => {
    const duration = parseDuration(video.contentDetails?.duration);
    if (includeShorts) {
        return duration <= 210; // Shorts page: only under 3m 30s
    } else {
        return duration > 210;  // Category pages: exclude under 3m 30s
    }
});
    if (filtered.length === 0) return [];

    // Step 4: Get channel subscriber counts
    const channelIds = [...new Set(filtered.map(v => v.snippet.channelId))].join(',');
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds}&key=${API_KEY}`;
    const channelResponse = await fetch(channelUrl);
    const channelData = await channelResponse.json();

    const channelMap = {};
    if (channelData.items) {
      channelData.items.forEach(ch => {
        channelMap[ch.id] = parseInt(ch.statistics.subscriberCount) || 0;
      });
    }

    // Step 5: Build video objects
    const videos = filtered.map(video => {
      const subscribers = channelMap[video.snippet.channelId] || 0;
      const views = parseInt(video.statistics.viewCount) || 0;
      const duration = parseDuration(video.contentDetails?.duration);

      return {
        videoId:      video.id,
        title:        video.snippet.title,
        channelId:    video.snippet.channelId,
        channelName:  video.snippet.channelTitle,
        thumbnail:    video.snippet.thumbnails.high.url,
        publishedAt:  video.snippet.publishedAt,
        publishedAgo: daysAgo(video.snippet.publishedAt),
        views:        views,
        viewsDisplay: formatNumber(views),
        subscribers:  subscribers,
        subsDisplay:  formatNumber(subscribers),
        duration:     duration,
        tier:         getTier(subscribers),
        videoUrl:     `https://www.youtube.com/watch?v=${video.id}`,
        channelUrl:   `https://www.youtube.com/channel/${video.snippet.channelId}`
      };
    });

    // Step 6: Add momentum to each video (compared within its tier group)
    const sorted = videos.sort((a, b) => b.views - a.views);

    sorted.forEach(video => {
      const tierVideos = sorted.filter(v => v.tier.name === video.tier.name);
      video.momentum = getMomentum(video.views, video.publishedAt, tierVideos);
    });

    return sorted;

  } catch (error) {
    console.error(`searchCategoryVideos failed for ${categoryKey}:`, error);
    return [];
  }
}

// ============================================================
//  SEARCH SHORTS ONLY
//  For the Shorts page — videos under 61 seconds
// ============================================================

async function searchShorts(daysBack = 7, maxResults = 150) {
  return searchCategoryVideos('shorts', daysBack, maxResults, true);
}

// ============================================================
//  GROUP BY TIER
// ============================================================

function groupByTier(videos, topN = 20) {
  const grouped = {};
  TIERS.forEach(tier => { grouped[tier.name] = []; });

  videos.forEach(video => {
    const tierName = video.tier.name;
    if (grouped[tierName] && grouped[tierName].length < topN) {
      grouped[tierName].push(video);
    }
  });

  return grouped;
}

// ============================================================
//  TOP VIDEOS ALL TIME
// ============================================================

async function getTopVideosAllTime(maxResults = 20) {
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent('ASMR')}&type=video&order=viewCount&maxResults=${maxResults}&key=${API_KEY}`;

  try {
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();
    if (!searchData.items) return [];

    const videoIds = searchData.items.map(item => item.id.videoId).join(',');
    const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${API_KEY}`;
    const videoResponse = await fetch(videoUrl);
    const videoData = await videoResponse.json();
    if (!videoData.items) return [];

    // Filter out Shorts
    return videoData.items
      .filter(video => parseDuration(video.contentDetails?.duration) > 60)
      .map(video => ({
        videoId:      video.id,
        title:        video.snippet.title,
        channelName:  video.snippet.channelTitle,
        thumbnail:    video.snippet.thumbnails.high.url,
        publishedAt:  video.snippet.publishedAt,
        views:        parseInt(video.statistics.viewCount) || 0,
        viewsDisplay: formatNumber(parseInt(video.statistics.viewCount) || 0),
        videoUrl:     `https://www.youtube.com/watch?v=${video.id}`,
        channelUrl:   `https://www.youtube.com/channel/${video.snippet.channelId}`
      }))
      .sort((a, b) => b.views - a.views);

  } catch (error) {
    console.error('getTopVideosAllTime failed:', error);
    return [];
  }
}

// ============================================================
//  MOST VIEWED FORTNIGHTLY
// ============================================================

async function getMostViewedFortnightly() {
  const results = await Promise.all(
    Object.keys(CATEGORIES)
      .filter(cat => cat !== 'shorts')
      .map(cat => searchCategoryVideos(cat, 14, 20))
  );

  const allVideos = results.flat();

  const seen = new Set();
  const unique = allVideos.filter(v => {
    if (seen.has(v.videoId)) return false;
    seen.add(v.videoId);
    return true;
  });

  return groupByTier(unique.sort((a, b) => b.views - a.views));
}

// ============================================================
//  FASTEST GROWING CHANNELS
// ============================================================

async function getFastestGrowingChannels() {
  const results = await Promise.all(
    Object.keys(CATEGORIES)
      .filter(cat => cat !== 'shorts')
      .map(cat => searchCategoryVideos(cat, 30, 20))
  );

  const allVideos = results.flat();

  const channelMap = {};
  allVideos.forEach(video => {
    if (!channelMap[video.channelId]) {
      channelMap[video.channelId] = {
        channelId:   video.channelId,
        channelName: video.channelName,
        channelUrl:  video.channelUrl,
        subscribers: video.subscribers,
        subsDisplay: video.subsDisplay,
        tier:        video.tier,
        recentViews: 0,
        videoCount:  0
      };
    }
    channelMap[video.channelId].recentViews += video.views;
    channelMap[video.channelId].videoCount  += 1;
  });

  const channels = Object.values(channelMap);
  channels.sort((a, b) => b.recentViews - a.recentViews);

  return groupByTier(channels.map(ch => ({
    ...ch,
    recentViewsDisplay: formatNumber(ch.recentViews)
  })));
}

// ============================================================
//  TOP ARTISTS
// ============================================================

async function getTopArtists() {
  const results = await Promise.all(
    Object.keys(CATEGORIES)
      .filter(cat => cat !== 'shorts')
      .map(cat => searchCategoryVideos(cat, 30, 20))
  );

  const allVideos = results.flat();

  const channelMap = {};
  allVideos.forEach(video => {
    if (!channelMap[video.channelId]) {
      channelMap[video.channelId] = {
        channelId:   video.channelId,
        channelName: video.channelName,
        channelUrl:  video.channelUrl,
        subscribers: video.subscribers,
        subsDisplay: video.subsDisplay,
        tier:        video.tier
      };
    }
  });

  const channels = Object.values(channelMap);
  channels.sort((a, b) => b.subscribers - a.subscribers);

  return groupByTier(channels);
}

// ============================================================
//  EXPORTS
// ============================================================

window.CreatorIndex = {
  CATEGORIES,
  TIERS,
  formatNumber,
  formatDate,
  daysAgo,
  getTier,
  parseDuration,
  getMomentum,
  searchCategoryVideos,
  searchShorts,
  groupByTier,
  getTopVideosAllTime,
  getMostViewedFortnightly,
  getFastestGrowingChannels,
  getTopArtists
};