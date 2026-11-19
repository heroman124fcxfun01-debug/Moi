import type { Book, UserCollection } from '../types/book';

export type BookSortMode =
  | 'recent'
  | 'added_desc'
  | 'title_asc'
  | 'title_desc'
  | 'author_asc'
  | 'progress_desc';

export type CollectionSortMode =
  | 'name_asc'
  | 'recent_read'
  | 'recent_added'
  | 'name_desc';

export function sortBooksByMode(books: Book[], mode: BookSortMode): Book[] {
  return [...books].sort((a, b) => {
    switch (mode) {
      case 'added_desc':
        return (b.addedAt || 0) - (a.addedAt || 0);
      case 'title_asc':
        return a.title.localeCompare(b.title, 'vi', { sensitivity: 'base' });
      case 'title_desc':
        return b.title.localeCompare(a.title, 'vi', { sensitivity: 'base' });
      case 'author_asc':
        return a.author.localeCompare(b.author, 'vi', { sensitivity: 'base' });
      case 'progress_desc':
        return (b.progressPercent || 0) - (a.progressPercent || 0);
      case 'recent':
      default:
        return (b.lastReadAt || 0) - (a.lastReadAt || 0);
    }
  });
}

export function sortCollectionsByMode(
  collections: UserCollection[],
  books: Book[],
  mode: CollectionSortMode
): UserCollection[] {
  const bookMap = new Map(books.map((b) => [b.id, b]));
  const getLatestReadAt = (col: UserCollection): number => {
    let maxTs = col.createdAt || 0;
    for (const id of col.bookIds) {
      const b = bookMap.get(id);
      if (b && b.lastReadAt > maxTs) {
        maxTs = b.lastReadAt;
      }
    }
    return maxTs;
  };

  return [...collections].sort((a, b) => {
    switch (mode) {
      case 'recent_read':
        return getLatestReadAt(b) - getLatestReadAt(a);
      case 'recent_added':
        return (b.createdAt || 0) - (a.createdAt || 0);
      case 'name_desc':
        return b.name.localeCompare(a.name, 'vi', { sensitivity: 'base' });
      case 'name_asc':
      default:
        return a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' });
    }
  });
}
