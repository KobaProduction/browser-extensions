export const CHATGPT_ORIGIN = 'https://chatgpt.com'

export function isChatGptPage(location: Location = window.location): boolean {
  return location.origin === CHATGPT_ORIGIN
}
