import React from 'react';
import { Icon } from './Icon';

export const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
     <rect x="6" y="6" width="12" height="12"></rect>
  </Icon>
);
