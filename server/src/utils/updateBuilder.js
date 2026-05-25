function buildUpdate(patch, mapping) {
  const sets = [];
  const params = [];

  for (const [field, config] of Object.entries(mapping)) {
    if (patch[field] === undefined) continue;
    const column = typeof config === 'string' ? config : config.column;
    const transform = typeof config === 'object' ? config.transform : null;
    sets.push(`${column} = ?`);
    params.push(transform ? transform(patch[field]) : patch[field]);
  }

  return { sets, params };
}

module.exports = {
  buildUpdate
};
