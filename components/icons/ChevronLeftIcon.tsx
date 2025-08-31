
import React from 'react';
import { Icon } from './Icon';

export const ChevronLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <polyline points="15 18 9 12 15 6"></polyline>
  </Icon>
);
