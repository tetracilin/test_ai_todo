import React from 'react';
import { Icon } from './Icon';

export const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </Icon>
);
