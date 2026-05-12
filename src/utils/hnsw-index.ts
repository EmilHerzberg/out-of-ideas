import hnswlib from 'hnswlib-node';
const { HierarchicalNSW } = hnswlib;
type HierarchicalNSW = InstanceType<typeof hnswlib.HierarchicalNSW>;

/**
 * Thin wrapper over hnswlib-node for cosine-similarity ANN dedup.
 * Indices are in-memory only — built fresh per run from the JSONL embeddings.
 */
export class CosineAnnIndex {
  private readonly index: HierarchicalNSW;
  private idMap: string[] = [];
  private readonly dimension: number;

  constructor(dimension: number, maxElements: number) {
    this.dimension = dimension;
    this.index = new HierarchicalNSW('cosine', dimension);
    this.index.initIndex(maxElements);
  }

  add(externalId: string, vector: number[]): void {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Vector dim ${vector.length} != index dim ${this.dimension}`,
      );
    }
    const internalId = this.idMap.length;
    this.idMap.push(externalId);
    this.index.addPoint(vector, internalId);
  }

  /**
   * Returns top-K nearest neighbors as { externalId, similarity (cosine) } pairs.
   * Excludes the query itself if it's in the index (matched by id equality).
   */
  searchKnn(
    queryVector: number[],
    k: number,
    excludeId?: string,
  ): Array<{ externalId: string; similarity: number }> {
    if (queryVector.length !== this.dimension) {
      throw new Error(
        `Query dim ${queryVector.length} != index dim ${this.dimension}`,
      );
    }
    const fetchK = excludeId ? k + 1 : k;
    if (this.idMap.length === 0) return [];
    const cappedK = Math.min(fetchK, this.idMap.length);
    const result = this.index.searchKnn(queryVector, cappedK);
    // hnswlib returns distances; for cosine distance, similarity = 1 - distance.
    const out: Array<{ externalId: string; similarity: number }> = [];
    for (let i = 0; i < result.neighbors.length; i += 1) {
      const internalId = result.neighbors[i];
      const distance = result.distances[i];
      const externalId = this.idMap[internalId];
      if (excludeId && externalId === excludeId) continue;
      out.push({ externalId, similarity: 1 - distance });
      if (out.length >= k) break;
    }
    return out;
  }

  size(): number {
    return this.idMap.length;
  }
}
