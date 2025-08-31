
import React from 'react';
import { Icon } from './Icon';

export const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <polyline points="6 9 12 15 18 9"></polyline>
  </Icon>
);
