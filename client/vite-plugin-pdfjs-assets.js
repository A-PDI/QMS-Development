/**
 * Serves pdf.js's standard font and CMap files at /pdfjs/… — in dev from
 * node_modules, and in the production build as emitted assets (Express then
 * serves them from client/dist like every other file).
 *
 * pdf.js needs these to draw PDFs that use the 14 standard fonts (Times,
 * Helvetica…) or CJK text without embedding them, which many business PDFs do.
 */
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'))
const DIRS = ['standard_fonts', 'cmaps']

export default function pdfjsAssets() {
  return {
    name: 'pdfjs-assets',

    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '')
        const [dir, ...rest] = rel.split('/')
        if (!DIRS.includes(dir) || rest.length !== 1 || rest[0].includes('..')) return next()
        const file = path.join(PDFJS_ROOT, dir, rest[0])
        fs.readFile(file, (err, data) => {
          if (err) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          res.end(data)
        })
      })
    },

    generateBundle() {
      for (const dir of DIRS) {
        const abs = path.join(PDFJS_ROOT, dir)
        if (!fs.existsSync(abs)) continue
        for (const name of fs.readdirSync(abs)) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(path.join(abs, name)) })
        }
      }
    },
  }
}
