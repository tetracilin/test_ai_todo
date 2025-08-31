

import { Perspective } from './types';

export const PERSONAL_PERSPECTIVES_ORDER: Perspective[] = [
    Perspective.Inbox,
    Perspective.Today,
    Perspective.Routines,
    Perspective.WorkPackages,
    Perspective.Tags,
    Perspective.Schedule,
    Perspective.Flagged,
    Perspective.Accountable,
    Perspective.Responsible,
    Perspective.Completed,
];

export const PROJECT_MANAGEMENT_PERSPECTIVES_ORDER: Perspective[] = [
    Perspective.Projects,
    Perspective.DecisionTable,
    Perspective.DecisionTree,
];
