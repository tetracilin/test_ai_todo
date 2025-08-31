import React from 'react';
import { Icon } from './Icon';

export const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </Icon>
);
