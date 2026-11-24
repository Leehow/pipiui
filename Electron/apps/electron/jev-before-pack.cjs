module.exports = async () => {
  const target = process.env.PIPIUI_EMBEDDED_RUNTIME_TARGET;
  if (!target) throw new Error('Packaging Jev requires PIPIUI_EMBEDDED_RUNTIME_TARGET');
  const { prepareJevPython } = await import('../../scripts/fetch-jev-python.mjs');
  prepareJevPython(target);
};
