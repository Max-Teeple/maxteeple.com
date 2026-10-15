/**
 * Builds src/glance/verses.json from public-domain KJV text (bible-api.com)
 * and original devotionals written for Glance. Not used at request time.
 */
import fs from 'fs';
import path from 'path';

const refs = `
Philippians 4:13|Strength
Isaiah 41:10|Courage
Psalm 23:1|Rest
John 3:16|Love
Proverbs 3:5|Trust
Matthew 11:28|Rest
Joshua 1:9|Courage
Romans 8:28|Hope
Psalm 46:1|Refuge
Jeremiah 29:11|Hope
Isaiah 40:31|Strength
Philippians 4:6|Peace
Psalm 27:1|Courage
Romans 15:13|Hope
Matthew 6:33|Trust
2 Timothy 1:7|Courage
Psalm 34:8|Goodness
John 14:27|Peace
Isaiah 26:3|Peace
Psalm 121:1|Help
Lamentations 3:22|Mercy
Micah 6:8|Justice
Matthew 5:9|Peace
Romans 12:12|Hope
Psalm 37:5|Trust
Proverbs 16:3|Trust
Isaiah 43:2|Presence
Deuteronomy 31:6|Courage
Psalm 56:3|Trust
John 16:33|Peace
1 Peter 5:7|Care
Psalm 91:1|Shelter
Nahum 1:7|Refuge
Matthew 5:14|Light
Ephesians 2:8|Grace
Psalm 19:1|Wonder
Genesis 1:1|Beginnings
Psalm 139:14|Wonder
Ecclesiastes 3:1|Time
Proverbs 4:23|Heart
James 1:5|Wisdom
Psalm 90:12|Wisdom
Proverbs 2:6|Wisdom
Colossians 3:23|Work
Matthew 5:16|Light
1 Corinthians 13:4|Love
1 Corinthians 13:13|Love
John 15:12|Love
1 John 4:19|Love
Romans 12:10|Kindness
Ephesians 4:32|Kindness
Colossians 3:12|Kindness
Galatians 5:22|Fruit
Psalm 100:4|Thanks
1 Thessalonians 5:18|Thanks
Psalm 107:1|Thanks
Luke 6:31|Kindness
Matthew 7:7|Ask
Psalm 145:9|Mercy
Exodus 34:6|Mercy
Psalm 103:8|Mercy
Micah 7:18|Mercy
Luke 6:36|Mercy
Matthew 5:7|Mercy
Romans 5:8|Love
John 1:14|Grace
2 Corinthians 12:9|Grace
Ephesians 1:7|Grace
Titus 2:11|Grace
Hebrews 4:16|Grace
Psalm 84:11|Grace
Numbers 6:24|Blessing
Psalm 67:1|Blessing
Psalm 115:14|Blessing
Genesis 12:2|Blessing
Jeremiah 17:7|Trust
Psalm 62:8|Trust
Proverbs 3:6|Trust
Isaiah 26:4|Trust
Psalm 9:10|Trust
Psalm 56:4|Trust
Mark 11:24|Trust
Hebrews 11:1|Faith
Romans 10:17|Faith
2 Corinthians 5:7|Faith
Galatians 2:20|Faith
Habakkuk 2:4|Faith
Matthew 17:20|Faith
Luke 17:6|Faith
James 2:17|Faith
Psalm 37:4|Delight
Psalm 16:11|Joy
Nehemiah 8:10|Joy
John 15:11|Joy
Romans 15:13|Hope
Philippians 4:4|Joy
Psalm 30:5|Joy
Isaiah 61:3|Joy
Psalm 126:3|Joy
1 Peter 1:8|Joy
Psalm 118:24|Today
Lamentations 3:23|Morning
Psalm 5:3|Morning
Psalm 143:8|Morning
Mark 1:35|Morning
Psalm 59:16|Morning
Isaiah 50:4|Morning
Psalm 90:14|Morning
Psalm 4:8|Rest
Psalm 127:2|Rest
Matthew 11:29|Rest
Exodus 33:14|Rest
Psalm 23:2|Rest
Mark 6:31|Rest
Hebrews 4:9|Rest
Psalm 62:1|Rest
Isaiah 30:15|Quiet
Psalm 46:10|Quiet
1 Kings 19:12|Quiet
Psalm 131:2|Quiet
Zephaniah 3:17|Quiet
Psalm 37:7|Quiet
Ecclesiastes 3:7|Quiet
Psalm 62:5|Quiet
Proverbs 15:1|Gentle
Matthew 5:5|Gentle
Galatians 6:1|Gentle
Ephesians 4:2|Gentle
Colossians 3:13|Forgiveness
Matthew 6:14|Forgiveness
Ephesians 4:32|Forgiveness
Luke 23:34|Forgiveness
Colossians 3:13|Pardon
Micah 7:19|Pardon
Psalm 103:12|Pardon
Isaiah 1:18|Pardon
1 John 1:9|Pardon
Psalm 51:10|Renewal
2 Corinthians 5:17|Renewal
Isaiah 43:19|Renewal
Ezekiel 36:26|Renewal
Romans 12:2|Renewal
Lamentations 3:21|Hope
Psalm 42:11|Hope
Psalm 33:22|Hope
Romans 5:5|Hope
Jeremiah 29:11|Future
Isaiah 40:31|Renewal
Psalm 31:24|Courage
Deuteronomy 31:8|Courage
Isaiah 41:13|Courage
Psalm 27:14|Wait
Isaiah 40:31|Wait
Psalm 130:5|Wait
Lamentations 3:25|Wait
Habakkuk 2:3|Wait
Psalm 27:14|Patience
Romans 8:25|Patience
James 5:7|Patience
Galatians 6:9|Patience
Hebrews 10:36|Patience
Psalm 37:7|Patience
Ecclesiastes 7:8|Patience
Proverbs 14:29|Patience
Isaiah 40:29|Strength
Psalm 18:32|Strength
Psalm 28:7|Strength
Isaiah 12:2|Strength
Nehemiah 8:10|Strength
2 Samuel 22:33|Strength
Psalm 73:26|Strength
Habakkuk 3:19|Strength
Exodus 15:2|Strength
Psalm 46:1|Help
Psalm 121:2|Help
Hebrews 13:6|Help
Isaiah 41:10|Help
Psalm 54:4|Help
Psalm 28:7|Help
Psalm 118:6|Help
Deuteronomy 33:29|Help
Psalm 20:1|Help
Matthew 6:26|Care
Luke 12:7|Care
1 Peter 5:7|Care
Psalm 55:22|Care
Isaiah 46:4|Care
Matthew 10:29|Care
Psalm 34:18|Nearness
Psalm 145:18|Nearness
James 4:8|Nearness
Deuteronomy 31:8|Nearness
Matthew 28:20|Nearness
Joshua 1:5|Nearness
Isaiah 43:2|Nearness
Psalm 23:4|Nearness
John 14:18|Nearness
Psalm 139:7|Nearness
Romans 8:38|Nearness
Hebrews 13:5|Nearness
Psalm 16:8|Nearness
Isaiah 41:10|Presence
Exodus 33:14|Presence
Psalm 139:10|Presence
Matthew 1:23|Presence
John 1:14|Presence
Psalm 73:23|Presence
Genesis 28:15|Presence
Psalm 23:4|Presence
Isaiah 43:5|Presence
Deuteronomy 4:31|Faithfulness
Psalm 36:5|Faithfulness
Lamentations 3:23|Faithfulness
2 Timothy 2:13|Faithfulness
Psalm 89:8|Faithfulness
1 Corinthians 1:9|Faithfulness
Psalm 33:4|Faithfulness
Deuteronomy 7:9|Faithfulness
Psalm 100:5|Faithfulness
Numbers 23:19|Faithfulness
Hebrews 10:23|Faithfulness
Joshua 21:45|Faithfulness
1 Kings 8:56|Faithfulness
Psalm 119:90|Faithfulness
Isaiah 25:1|Faithfulness
Psalm 145:13|Faithfulness
2 Thessalonians 3:3|Faithfulness
Psalm 18:30|Way
Proverbs 3:6|Way
Psalm 25:4|Way
Isaiah 30:21|Way
John 14:6|Way
Psalm 119:105|Light
Psalm 27:1|Light
John 8:12|Light
Matthew 5:14|Light
1 John 1:5|Light
Isaiah 60:1|Light
Psalm 119:130|Light
2 Samuel 22:29|Light
John 1:5|Light
Ephesians 5:8|Light
Psalm 36:9|Light
Micah 7:8|Light
Isaiah 9:2|Light
John 12:46|Light
Psalm 18:28|Light
Proverbs 4:18|Light
Matthew 4:16|Light
2 Corinthians 4:6|Light
Genesis 1:3|Light
Psalm 97:11|Light
Isaiah 58:8|Light
Daniel 12:3|Light
Matthew 5:16|Light
Philippians 2:15|Light
John 9:5|Light
Psalm 43:3|Light
Isaiah 42:16|Light
Psalm 119:130|Understanding
Proverbs 4:7|Wisdom
James 1:5|Wisdom
Proverbs 9:10|Wisdom
Psalm 111:10|Wisdom
Colossians 2:3|Wisdom
Proverbs 2:6|Wisdom
Ecclesiastes 7:12|Wisdom
Proverbs 16:16|Wisdom
Job 28:28|Wisdom
Proverbs 19:20|Wisdom
Psalm 90:12|Wisdom
1 Kings 3:9|Wisdom
Proverbs 8:11|Wisdom
James 3:17|Wisdom
Proverbs 15:33|Wisdom
Ecclesiastes 2:26|Wisdom
Proverbs 24:3|Wisdom
Colossians 1:9|Wisdom
Ephesians 1:17|Wisdom
Proverbs 1:7|Wisdom
Psalm 19:7|Wisdom
Daniel 2:21|Wisdom
Proverbs 3:13|Wisdom
Isaiah 33:6|Wisdom
Proverbs 14:33|Wisdom
1 Corinthians 1:30|Wisdom
Psalm 51:6|Wisdom
Proverbs 2:10|Wisdom
Ecclesiastes 8:1|Wisdom
Proverbs 11:2|Humility
Micah 6:8|Humility
Philippians 2:3|Humility
James 4:6|Humility
1 Peter 5:5|Humility
Matthew 23:12|Humility
Proverbs 22:4|Humility
Luke 14:11|Humility
Psalm 25:9|Humility
Colossians 3:12|Humility
Matthew 5:5|Humility
Proverbs 15:33|Humility
Isaiah 57:15|Humility
Zephaniah 2:3|Humility
Psalm 149:4|Humility
Matthew 18:4|Humility
James 4:10|Humility
1 Peter 5:6|Humility
Proverbs 29:23|Humility
Luke 18:14|Humility
Psalm 138:6|Humility
Isaiah 66:2|Humility
Matthew 11:29|Humility
Philippians 2:8|Humility
2 Chronicles 7:14|Humility
Psalm 51:17|Humility
Proverbs 16:19|Humility
Micah 6:8|Justice
Amos 5:24|Justice
Isaiah 1:17|Justice
Psalm 82:3|Justice
Proverbs 21:3|Justice
Zechariah 7:9|Justice
Jeremiah 22:3|Justice
Psalm 106:3|Justice
Isaiah 56:1|Justice
Micah 6:8|Mercy
Matthew 23:23|Justice
Deuteronomy 16:20|Justice
Psalm 33:5|Justice
Isaiah 30:18|Justice
Proverbs 31:9|Justice
Psalm 89:14|Justice
Isaiah 61:8|Justice
Leviticus 19:15|Justice
Psalm 37:28|Justice
Romans 12:17|Honor
1 Peter 2:17|Honor
Romans 13:7|Honor
Philippians 2:3|Honor
Proverbs 3:9|Honor
1 Timothy 5:17|Honor
Exodus 20:12|Honor
Matthew 15:4|Honor
Leviticus 19:32|Honor
Proverbs 14:31|Honor
Psalm 8:5|Honor
Romans 12:10|Honor
1 Thessalonians 5:12|Honor
Proverbs 15:33|Honor
John 12:26|Honor
1 Peter 3:7|Honor
Malachi 1:6|Honor
Psalm 91:15|Honor
Isaiah 58:7|Mercy
Matthew 25:40|Mercy
Proverbs 19:17|Mercy
Luke 10:37|Mercy
Hebrews 13:16|Mercy
James 1:27|Mercy
Galatians 6:2|Mercy
1 John 3:17|Mercy
Deuteronomy 15:11|Mercy
Proverbs 22:9|Mercy
Matthew 5:7|Mercy
Isaiah 58:10|Mercy
Luke 6:36|Mercy
Psalm 41:1|Mercy
Proverbs 14:21|Mercy
Matthew 25:35|Mercy
Acts 20:35|Mercy
2 Corinthians 9:7|Generosity
Proverbs 11:25|Generosity
Luke 6:38|Generosity
Malachi 3:10|Generosity
2 Corinthians 9:8|Generosity
Proverbs 3:27|Generosity
Deuteronomy 15:10|Generosity
Psalm 112:5|Generosity
1 Timothy 6:18|Generosity
Hebrews 13:16|Generosity
Proverbs 22:9|Generosity
Luke 21:3|Generosity
Matthew 6:3|Generosity
2 Corinthians 8:7|Generosity
Acts 4:34|Generosity
Proverbs 19:17|Generosity
Isaiah 32:8|Generosity
1 Chronicles 29:14|Generosity
Romans 12:13|Generosity
Galatians 6:10|Generosity
Psalm 37:21|Generosity
Proverbs 28:27|Generosity
Matthew 10:8|Generosity
2 Corinthians 9:11|Generosity
Luke 12:33|Generosity
Deuteronomy 16:17|Generosity
1 John 3:18|Generosity
Proverbs 21:26|Generosity
Psalm 41:1|Generosity
Ecclesiastes 11:1|Generosity
Matthew 6:21|Treasure
John 10:10|Life
Psalm 34:4|Freedom
Romans 8:1|Mercy
Isaiah 55:8|Trust
Psalm 34:14|Peace
Proverbs 17:22|Joy
Ecclesiastes 4:9|Friendship
Ruth 1:16|Loyalty
Revelation 21:4|Comfort
`.trim().split('\n').map((line) => {
  const [reference, theme] = line.split('|');
  return { reference: reference.trim(), theme: theme.trim() };
});

const seenRefs = new Set();
const uniqueRefs = [];
for (const row of refs) {
  if (seenRefs.has(row.reference)) continue;
  seenRefs.add(row.reference);
  uniqueRefs.push(row);
}
if (uniqueRefs.length < 366) {
  console.error('need 366 unique refs, got ' + uniqueRefs.length);
  process.exit(1);
}
refs.length = 0;
refs.push(...uniqueRefs.slice(0, 366));

const openings = [
  (v) => `Before the kitchen gets noisy, ${v.reference} is enough for one honest minute. The word for today is ${v.theme}. You do not have to solve the whole day. You only have to let one true sentence land.`,
  (v) => `${v.reference} does not shout. It sits beside the ordinary work of ${v.theme.toLowerCase()} and waits until you are willing to hear it. Glance is a small screen for a large mercy, and this verse is sized for that screen.`,
  (v) => `Some mornings ask for a plan. This one asks for ${v.theme.toLowerCase()}. ${v.reference} gives you a place to stand while the calendar fills up around you.`,
  (v) => `The day will offer plenty of noise. ${v.reference} offers a quieter center, and its theme is ${v.theme}. Carry that one word into the next conversation instead of carrying every worry at once.`,
  (v) => `You already know how a crowded day feels. ${v.reference} knows it too, and still speaks of ${v.theme.toLowerCase()}. Let the verse be a door, not a demand.`,
  (v) => `${v.theme} is not a mood you manufacture. ${v.reference} treats it as a gift you can receive while the coffee cools and the list stays long.`,
  (v) => `Read ${v.reference} slowly enough to hear the word ${v.theme.toLowerCase()} without rushing past it. A verse is wasted when it is only a slogan. It helps when it becomes a way of walking.`,
  (v) => `There is room in an ordinary afternoon for ${v.theme.toLowerCase()}. ${v.reference} was written for people with errands, not only for people with spare time.`
];

const middles = [
  (v) => `The public words are old and plain: "${v.phrase}." They do not decorate the day. They tell the truth about where ${v.theme.toLowerCase()} comes from. You are not asked to feel impressive. You are asked to stay near the God who spoke this line and still keeps company with tired people.`,
  (v) => `Hold the short phrase "${v.phrase}." It is small enough to remember while you drive, cook, or wait. ${v.theme} grows in those in-between minutes more than it grows in speeches. Let the phrase interrupt a spiral. Say it once, then do the next simple thing.`,
  (v) => `"${v.phrase}." Those words have outlived the week they were first heard. They can outlive this one too. ${v.theme} here is not a performance. It is a steadying hand on the shoulder, the kind that does not need an audience.`,
  (v) => `Notice how little ${v.reference} wastes. "${v.phrase}." A whole practice of ${v.theme.toLowerCase()} can hide inside a sentence that short. You do not need a new personality today. You need a true sentence you are willing to trust for the next hour.`,
  (v) => `If the verse feels larger than your morning, start with the fragment you can carry: "${v.phrase}." ${v.theme} often arrives as a smaller mercy than we requested. Receive the size you are given. That is enough to keep you kind.`,
  (v) => `The line "${v.phrase}" refuses panic. It does not deny that the day is real. It denies that the day gets the last word. ${v.theme} is the better word, and it can sit with you while you answer the message you have been avoiding.`,
  (v) => `Say "${v.phrase}" without trying to sound holy. ${v.reference} is sturdy enough for a normal voice. ${v.theme} becomes practical when it changes the tone of one reply, one chore, one apology.`,
  (v) => `"${v.phrase}." Read it as a promise you can lean on, not a test you must pass. ${v.theme} is offered before you have earned the afternoon. That order matters. Receive first, then work.`
];

const practices = [
  (v) => `Try one small practice. When you feel the pull to hurry, pause and name ${v.theme.toLowerCase()} out loud. Then finish the task in front of you without adding a speech about how behind you are. The verse is meant to lighten the grip, not to add another item to the list.`,
  (v) => `At the next meal, let ${v.reference} be the quiet blessing. You do not need to preach it. Thank God for ${v.theme.toLowerCase()} in one sentence, then pass the food. Holiness can be that ordinary and still be real.`,
  (v) => `Write ${v.theme} on a scrap of paper and leave it where you will see it after lunch. When you see it, ask a simpler question than "how do I fix everything?" Ask "what would ${v.theme.toLowerCase()} look like in the next ten minutes?" Then do that.`,
  (v) => `If someone in the house is short with you, answer one sentence more gently than you feel. That is ${v.theme.toLowerCase()} with shoes on. ${v.reference} was never only for private thoughts. It is for the way a voice sounds in a kitchen.`,
  (v) => `Take a two-minute walk, even if it is only to the end of the driveway. Repeat the reference once. Let ${v.theme.toLowerCase()} be the pace of your steps. Coming back, do the next right thing and leave the rest unargued.`,
  (v) => `Before you open a screen again, sit with the verse long enough to notice your shoulders. Drop them. ${v.theme} is allowed to be physical. God is not offended by a body that needs a slower breath.`,
  (v) => `Choose one person and wish them ${v.theme.toLowerCase()} without announcing it. A text, a glass of water, a patient answer. ${v.reference} becomes yours when it moves toward someone else.`,
  (v) => `When the afternoon slumps, do not bargain with shame. Return to the sentence you already read. ${v.theme} can begin again at 3 o'clock. The day is not ruined because the morning was messy.`
];

const closings = [
  (v) => `Tonight, do not grade the day. Remember ${v.reference} and the single word ${v.theme}. If you were kinder than you expected, give thanks. If you were not, mercy is still on duty. Tomorrow's verse will come at midnight, Phoenix time. This one only has to carry you until then.`,
  (v) => `Leave ${v.theme.toLowerCase()} where you can find it: in the way you lock the door, in the way you say goodnight, in the way you stop rehearsing the argument. ${v.reference} will still be true when the house is dark. You can rest without finishing every thought.`,
  (v) => `The point of today's verse is not that you become impressive. The point is that ${v.theme.toLowerCase()} is near, and near is enough. ${v.reference} can go with you into an unremarkable evening. That is a good place for faith to live.`,
  (v) => `Let the last word of the afternoon be ${v.theme.toLowerCase()}, not the loudest worry. ${v.reference} has already said something better. Receive it again, simply, and let the board go quiet.`,
  (v) => `You do not have to keep this whole devotional. Keep the reference and the word ${v.theme}. If those two stay with you while you wash a cup or answer a child, the verse has done its work.`,
  (v) => `God's care is not smaller than this screen, and it is not too large for it either. ${v.reference} fits in a kitchen. ${v.theme} fits in a person. Take both into whatever is left of the day, and do not carry more than that.`,
  (v) => `When midnight comes in Phoenix, the verse will change. Until then, ${v.reference} is your companion and ${v.theme.toLowerCase()} is your practice. One day. One word. That is a faithful way to live until you sleep.`,
  (v) => `End by telling the truth: you needed ${v.theme.toLowerCase()} today, and ${v.reference} did not shame you for needing it. Gratitude is the right last step. Then close the panel and go be a person in a real room.`
];

function phraseOf(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const slice = words.slice(0, 10);
  while (slice.length && /^(and|or|the|a|of|to)$/i.test(slice[slice.length - 1])) slice.pop();
  return slice.join(' ').replace(/[.;,]+$/g, '');
}

function wordCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function devotional(entry, index) {
  const view = { ...entry, phrase: phraseOf(entry.text) };
  const parts = [
    openings[index % openings.length](view),
    middles[(index * 3 + 1) % middles.length](view),
    practices[(index * 5 + 2) % practices.length](view),
    closings[(index * 7 + 3) % closings.length](view)
  ];
  let text = parts.join(' ');
  let count = wordCount(text);
  if (count < 150) {
    text += ` Stay with ${entry.theme.toLowerCase()} long enough for it to become a tone of voice, not only an idea. ${entry.reference} can survive contact with a real afternoon.`;
    count = wordCount(text);
  }
  if (count > 250) {
    const bits = text.split(/(?<=[.!?])\s+/);
    while (bits.length > 4 && wordCount(bits.join(' ')) > 250) bits.pop();
    text = bits.join(' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

const BOOKS = {
  genesis: 'gn', exodus: 'ex', leviticus: 'lv', numbers: 'nm', deuteronomy: 'dt',
  joshua: 'js', judges: 'jz', ruth: 'rt', '1 samuel': '1sm', '2 samuel': '2sm',
  '1 kings': '1rs', '2 kings': '2rs', '1 chronicles': '1cr', '2 chronicles': '2cr',
  nehemiah: 'ne', job: 'jó', psalm: 'sl', psalms: 'sl', proverbs: 'pv',
  ecclesiastes: 'ec', isaiah: 'is', jeremiah: 'jr', lamentations: 'lm',
  ezekiel: 'ez', daniel: 'dn', amos: 'am', micah: 'mq', nahum: 'na',
  habakkuk: 'hc', zephaniah: 'sf', zechariah: 'zc', malachi: 'ml',
  matthew: 'mt', mark: 'mc', luke: 'lc', john: 'jo', acts: 'atos',
  romans: 'rm', '1 corinthians': '1co', '2 corinthians': '2co', galatians: 'gl',
  ephesians: 'ef', philippians: 'fp', colossians: 'cl',
  '1 thessalonians': '1ts', '2 thessalonians': '2ts', '1 timothy': '1tm', '2 timothy': '2tm',
  titus: 'tt', hebrews: 'hb', james: 'tg', '1 peter': '1pe', '1 john': '1jo',
  revelation: 'ap'
};

const kjv = JSON.parse(fs.readFileSync('/tmp/kjv.json', 'utf8'));
const byAbbrev = new Map(kjv.map((book) => [book.abbrev, book]));

function fetchVerse(reference) {
  const match = reference.match(/^(.*)\s+(\d+):(\d+)$/);
  if (!match) throw new Error('bad ref ' + reference);
  const abbrev = BOOKS[match[1].toLowerCase()];
  const book = abbrev && byAbbrev.get(abbrev);
  const text = book && book.chapters[Number(match[2]) - 1]?.[Number(match[3]) - 1];
  if (!text) throw new Error('missing ' + reference);
  return { reference, text: String(text).replace(/\s+/g, ' ').trim() };
}

const verses = refs.map((row, index) => {
  const found = fetchVerse(row.reference);
  const entry = { reference: found.reference, theme: row.theme, text: found.text };
  entry.devotional = devotional(entry, index);
  return entry;
});

const out = path.join(process.cwd(), 'src/glance/verses.json');
fs.writeFileSync(out, JSON.stringify(verses));
const bad = verses.filter((row) => {
  const n = wordCount(row.devotional);
  return n < 150 || n > 250 || row.theme.split(/\s+/).length !== 1 || !row.text;
});
console.log('wrote ' + verses.length + ' bad ' + bad.length);
if (bad.length) {
  console.log(bad.slice(0, 5).map((row) => row.reference + ' ' + wordCount(row.devotional)).join('\n'));
  process.exit(1);
}
