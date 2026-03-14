import { readFileSync, writeFileSync } from 'fs';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { openDb } from '../db/schema.js';
import { Queries, Feed, Category } from '../db/queries.js';

interface OpmlOutline {
  '@_text'?: string;
  '@_title'?: string;
  '@_xmlUrl'?: string;
  '@_htmlUrl'?: string;
  '@_type'?: string;
  outline?: OpmlOutline | OpmlOutline[];
}

interface OpmlDoc {
  opml: {
    '@_version'?: string;
    head?: { title?: string };
    body: {
      outline?: OpmlOutline | OpmlOutline[];
    };
  };
}

export async function cmdOpmlImport(file: string): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  const xmlContent = readFileSync(file, 'utf-8');
  const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = xmlParser.parse(xmlContent) as OpmlDoc;

  const body = doc.opml?.body;
  if (!body) {
    console.error('Invalid OPML: missing <body>');
    process.exit(1);
  }

  let outlines: OpmlOutline[] = [];
  if (body.outline) {
    outlines = Array.isArray(body.outline) ? body.outline : [body.outline];
  }

  let addedFeeds = 0;
  let addedCategories = 0;
  let skipped = 0;

  async function processOutline(outline: OpmlOutline, parentCategoryId?: number): Promise<void> {
    const xmlUrl = outline['@_xmlUrl'];
    const text = outline['@_text'] ?? outline['@_title'] ?? '';

    if (xmlUrl) {
      // This is a feed
      const existing = q.getFeedByUrl(xmlUrl);
      if (existing) {
        skipped++;
        return;
      }

      const feed = q.createFeed(xmlUrl, text, outline['@_htmlUrl']);
      if (parentCategoryId != null) {
        q.moveFeedToCategory(feed.id, parentCategoryId);
      }
      addedFeeds++;
    } else {
      // This is a category folder
      let category = q.getCategoryByName(text);
      if (!category) {
        category = q.createCategory(text, parentCategoryId);
        addedCategories++;
      }

      // Process children
      if (outline.outline) {
        const children = Array.isArray(outline.outline) ? outline.outline : [outline.outline];
        for (const child of children) {
          // Only 1 level of nesting supported — flatten deeper nesting
          await processOutline(child, category.id);
        }
      }
    }
  }

  for (const outline of outlines) {
    await processOutline(outline);
  }

  console.log(
    `OPML import complete: ${addedFeeds} feeds added, ${addedCategories} categories created, ${skipped} skipped (duplicates).`
  );
}

export async function cmdOpmlExport(file?: string): Promise<void> {
  const db = openDb();
  const q = new Queries(db);

  const feeds = q.getAllFeeds();
  const categories = q.getCategories();

  const categoryMap = new Map<number, Category>();
  for (const cat of categories) {
    categoryMap.set(cat.id, cat);
  }

  // Group feeds by category
  const feedsByCategory = new Map<number | null, Feed[]>();
  for (const feed of feeds) {
    const catId = feed.category_id;
    if (!feedsByCategory.has(catId)) feedsByCategory.set(catId, []);
    feedsByCategory.get(catId)!.push(feed);
  }

  function feedToOutline(feed: Feed): OpmlOutline {
    return {
      '@_text': feed.title || feed.url,
      '@_title': feed.title || feed.url,
      '@_type': 'rss',
      '@_xmlUrl': feed.url,
      '@_htmlUrl': feed.site_url ?? '',
    };
  }

  const outlines: OpmlOutline[] = [];

  // Categorised feeds (root categories first)
  const rootCategories = categories.filter((c) => c.parent_id == null);
  for (const rootCat of rootCategories) {
    const children: OpmlOutline[] = [];

    // Feeds in this root category
    const rootFeeds = feedsByCategory.get(rootCat.id) ?? [];
    for (const feed of rootFeeds) {
      children.push(feedToOutline(feed));
    }

    // Sub-categories
    const subCats = categories.filter((c) => c.parent_id === rootCat.id);
    for (const subCat of subCats) {
      const subFeeds = feedsByCategory.get(subCat.id) ?? [];
      if (subFeeds.length > 0) {
        children.push({
          '@_text': subCat.name,
          '@_title': subCat.name,
          outline: subFeeds.map(feedToOutline),
        });
      }
    }

    if (children.length > 0) {
      outlines.push({
        '@_text': rootCat.name,
        '@_title': rootCat.name,
        outline: children,
      });
    }
  }

  // Uncategorized feeds
  const uncategorized = feedsByCategory.get(null) ?? [];
  for (const feed of uncategorized) {
    outlines.push(feedToOutline(feed));
  }

  const opmlDoc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    opml: {
      '@_version': '2.0',
      head: { title: 'ladder subscriptions' },
      body: { outline: outlines },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    processEntities: true,
    cdataPropName: '__cdata',
  });

  const xml = builder.build(opmlDoc) as string;

  if (file) {
    writeFileSync(file, xml, 'utf-8');
    console.log(`OPML exported to: ${file}`);
  } else {
    process.stdout.write(xml);
  }
}
