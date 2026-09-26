// Merging two copies of the training data (this device vs the server).
// Pure functions, no DOM or network, so they can be unit-tested.

/** When an item last changed. Items from before sync existed only have createdAt. */
const stamp = (item) => item.updatedAt || item.createdAt || 0;

function mergeList(local, remote, deleted) {
  const byId = new Map();
  for (const item of remote) byId.set(item.id, item);
  for (const item of local) {
    const other = byId.get(item.id);
    if (!other || stamp(item) >= stamp(other)) byId.set(item.id, item);
  }
  // A deletion wins over any version of the item that isn't newer than the deletion.
  return [...byId.values()].filter((item) => !(deleted[item.id] >= stamp(item)));
}

/**
 * Combines two states. Workouts and climbs are matched by id and the newer edit wins;
 * deletions (tombstones in `deleted`) are kept so they reach every device; the most
 * recently changed settings win as a whole. The draft always comes from `local`.
 */
export function merge(local, remote) {
  if (!remote) return local;
  const deleted = { ...remote.deleted };
  for (const [id, t] of Object.entries(local.deleted || {})) deleted[id] = Math.max(t, deleted[id] || 0);
  const localSettingsWin = (local.settingsUpdatedAt || 0) >= (remote.settingsUpdatedAt || 0);
  return {
    ...local,
    workouts: mergeList(local.workouts, remote.workouts || [], deleted),
    boulders: mergeList(local.boulders, remote.boulders || [], deleted),
    deleted,
    settings: localSettingsWin ? local.settings : { ...local.settings, ...remote.settings },
    settingsUpdatedAt: Math.max(local.settingsUpdatedAt || 0, remote.settingsUpdatedAt || 0),
  };
}
