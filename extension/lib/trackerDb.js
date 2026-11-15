// Tracker database: O(k) suffix lookup where k = number of labels in the hostname.
// The most specific match wins, so "analytics.tiktok.com" (advertising) overrides "tiktok.com" (social).
export class TrackerDb {
  constructor(dataset) {
    this.version = dataset.version;
    this.categories = dataset.categories;
    this.index = new Map();
    for (const t of dataset.trackers) {
      if (!this.categories[t.category]) throw new Error(`Unknown category ${t.category} for ${t.domain}`);
      this.index.set(t.domain.toLowerCase(), t);
    }
  }
  get size() { return this.index.size; }

  match(host) {
    if (!host) return null;
    const labels = host.toLowerCase().split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const candidate = labels.slice(i).join('.');
      const hit = this.index.get(candidate);
      if (hit) return { ...hit, matchedOn: candidate };
    }
    return null;
  }
}
