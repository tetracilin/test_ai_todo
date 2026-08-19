// Simulate the GUI's GET /agents/:id/skills path: adapter.listSkills(ctx) with host runtime config
const { listSkills } = await import('/paperclip/adapter-plugins/openrouter/src/server/index.ts');
const { createDb } = await import('/app/node_modules/@paperclipai/db/dist/index.js');
const { companySkillService } = await import('/app/server/dist/services/company-skills.js');

const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
const svc = companySkillService(db);
const COMPANY = "2588c455-47ca-4b0f-ba96-b5bf63a9c796";

// What the host passes as runtimeConfig.paperclipRuntimeSkills
const entries = await svc.listRuntimeSkillEntries(COMPANY, { materializeMissing: false });

// The GUI path passes config with paperclipRuntimeSkills — but does the adapter read it?
const snapshot = await listSkills({
  agentId: 'c011ce22-90da-4896-b4aa-cea167023111',
  companyId: COMPANY,
  adapterType: 'openrouter',
  config: { paperclipRuntimeSkills: entries },
});
console.log('GUI snapshot entries:', snapshot.entries.length);
console.log('GUI snapshot supported:', snapshot.supported, 'mode:', snapshot.mode);
console.log(JSON.stringify(snapshot.entries.slice(0, 3), null, 1));
console.log('warnings:', snapshot.warnings);
process.exit(0);