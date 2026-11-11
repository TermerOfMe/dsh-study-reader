/**
 * Host half of the Study Reader bundle.
 *
 * The browser half registers a main panel and a sidebar entry; this half owns
 * document extraction and the two model-backed operations. There are no
 * model-facing tools and no Session events: the reader deliberately keeps
 * study state in the page, so opening a book never edits a conversation.
 */
import { installStudyHost } from './lib/app.js'

export const inject = ['webServer']

export function apply(ctx, config) {
  installStudyHost(ctx, config)
}
