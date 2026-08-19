# 2023-10-05-paperclip-work

## Objective
Implement Paperclip agent workflow integration following repository guidelines from AGENTS.md

## Scope
1. Create agent integration following company-scoped architecture
2. Ensure contract synchronization across db/shared/server/ui layers
3. Maintain control-plane invariants during implementation

## Steps
1. Review doc/SPEC-implementation.md for V1 requirements
2. Implement adapter in packages/adapters/ per AGENTS.md structure
3. Add schema changes to packages/db/src/schema/ with migration
4. Update shared types in packages/shared/
5. Implement server routes with proper auth checks
6. Add UI components using token-based design system

## Verification
1. Run pnpm test for unit tests
2. Validate typecheck with pnpm -r typecheck
3. Confirm API behavior with curl tests
4. Run pnpm check:token-gates for UI compliance

## Risks
- Missing company scoping in new routes
- Schema/type mismatches across layers
- Non-compliant UI token usage

## Completion Criteria
1. All changes match doc/SPEC-implementation.md
2. Typecheck, tests, and build pass
3. Contracts synced across layers
4. Docs updated with new functionality
5. PR template fully completed