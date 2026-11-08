export const RECIPE_INBOX_KEY = 'home-shopping-list:recipe-import-v1';

export function readRecipeInbox() {
  if (!document.body.dataset.recipeHome || new URLSearchParams(location.search).get('from') !== 'recipe') return null;
  return sessionStorage.getItem(RECIPE_INBOX_KEY);
}

export function clearRecipeInbox() {
  try {
    sessionStorage.removeItem(RECIPE_INBOX_KEY);
  } catch {
    // The import has committed. A retained inbox is still protected by its fingerprint.
  }
}
