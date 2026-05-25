const MATCH_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
};

const ROUND_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
};

const SEASON_STATUS = {
  PENDING: 'pending',
  ONGOING: 'ongoing',
  COMPLETED: 'completed'
};

const MATCH_FORMAT = {
  BO1: 'bo1',
  BO3: 'bo3',
  PA7: 'pa7'
};

const WINNER_SIDE = {
  A: 'a',
  B: 'b'
};

const RULE_ID = {
  STANDARD: 'standard',
  S2: 's2',
  S3: 's3',
  S4: 's4',
  S5: 's5'
};

const SCORING_MODE = {
  STANDARD: 'standard',
  RESISTANCE: 'resistance'
};

module.exports = {
  MATCH_STATUS,
  ROUND_STATUS,
  SEASON_STATUS,
  MATCH_FORMAT,
  WINNER_SIDE,
  RULE_ID,
  SCORING_MODE
};
