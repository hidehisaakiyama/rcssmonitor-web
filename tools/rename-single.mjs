// Gives the single-file build its release name.
import { renameSync } from 'node:fs';

renameSync('dist-single/index.html', 'dist-single/rcssmonitor-web.html');
