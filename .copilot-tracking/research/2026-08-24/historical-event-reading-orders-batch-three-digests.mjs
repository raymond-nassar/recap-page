import { readFile } from 'node:fs/promises';
import {
  CBRO_BATCH_THREE_TOUCHED_IDS,
  CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256,
  CBRO_BATCH_TWO_SELECTED_IDS,
  digestCanonicalJson,
} from '../../../scripts/lib/cbro-evidence.mjs';

const inventory = JSON.parse(await readFile(
  new URL('../../../scripts/data/cbro-historical-inventory.json', import.meta.url),
  'utf8',
));
const identity = inventory.map(({
  catalogIds: _catalogIds,
  deliveryStatus: _deliveryStatus,
  ...record
}) => record);
const batchTwoNonselected = inventory
  .filter((record) => !CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id))
  .map((record) => CBRO_BATCH_THREE_TOUCHED_IDS.includes(record.id)
    ? {
        ...record,
        centralDisposition: 'deferred',
        relationshipStatus: 'unresolved',
        reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
        overlapIds: [],
        catalogIds: [],
        deliveryStatus: 'deferred',
      }
    : record);
const batchThreeNonselected = inventory.filter(
  (record) => !CBRO_BATCH_THREE_TOUCHED_IDS.includes(record.id),
);

console.log(JSON.stringify({
  identity: digestCanonicalJson(identity),
  batchTwoNonselected: digestCanonicalJson(batchTwoNonselected),
  expectedBatchTwoNonselected: CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256,
  batchThreeNonselected: digestCanonicalJson(batchThreeNonselected),
}, null, 2));
