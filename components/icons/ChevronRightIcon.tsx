
import React from 'react';
import { Icon } from './Icon';

export const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <polyline points="9 18 15 12 9 6"></polyline>
  </Icon>
);
