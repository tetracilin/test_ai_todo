
import React from 'react';
import { Icon } from './Icon';

export const CircleIcon: React.FC<{ className?: string, title?: string }> = ({ className, title }) => (
  <Icon className={className} title={title}>
    <circle cx="12" cy="12" r="10"></circle>
  </Icon>
);
