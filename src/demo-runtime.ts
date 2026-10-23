import fixture from '../demo/fictional-lab.json';
// @ts-expect-error The shared fixture utility is plain JavaScript and covered by its own tests.
import { rebaseDemo } from '../demo/fixture.mjs';
import { createBrowserStore } from './browser-store';
import type { LabRecord } from '../components/lab/model';
export const browserDemo = createBrowserStore(rebaseDemo(fixture) as { records: LabRecord[]; links: { project_id: string; student_id: string }[] }, localStorage);
