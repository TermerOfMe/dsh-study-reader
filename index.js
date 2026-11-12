/**
 * Host half of the Study Reader bundle.
 *
 * The browser half registers a main panel and a sidebar entry; this half owns
 * document extraction, model operations and durable annotations. The optional
 * study_annotations tool shares the UI's storage operation. Opening a book and
 * using the reader do not append Session events.
 */
import { installStudyHost } from './lib/app.js'

export const inject = ['webServer']

export function apply(ctx, config) {
  installStudyHost(ctx, config)
}
