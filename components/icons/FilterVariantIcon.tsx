
import React from 'react';
import { Icon } from './Icon';

export const FilterVariantIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <path d="M3 3v1.5L9.5 12v4.5l5 2V12L21 4.5V3H3z"></path>
  </Icon>
);
