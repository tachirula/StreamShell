import { config } from 'dotenv'
import { join } from 'path'

// In dev, process.cwd() is `electron-app/`, so this resolves to
// `electron-app/.env` — exactly where the file lives now.
config({ path: join(process.cwd(), '.env') })