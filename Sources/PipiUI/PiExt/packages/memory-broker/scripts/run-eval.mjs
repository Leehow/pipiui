import corpus from '../eval/corpus.json' with { type: 'json' };
if (!Array.isArray(corpus.cases) || corpus.version !== 1) throw new Error('invalid memory eval corpus');
console.log(`memory-broker eval corpus: ${corpus.cases.length} cases`);
