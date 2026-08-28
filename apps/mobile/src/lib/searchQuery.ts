export const MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH = 200;
export const MOBILE_VCS_SEARCH_QUERY_MAX_LENGTH = 256;

export function limitMobileSearchQuery(query: string, maxLength: number): string {
  return query.length <= maxLength ? query : query.slice(0, maxLength);
}
