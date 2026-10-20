import { describe, expect, it } from 'vitest';
import { categoryFromText, placeFromText, welcomeFromText } from '../src/ai/keywords.js';
import { createGeo } from '../src/geo/index.js';
import { testConfig } from './helpers.js';

const geo = createGeo(testConfig().paths.countiesFile);

describe('keywords (when the AI is not available)', () => {
  it.each([
    ['I need a divorce attorney', 'attorney'],
    ['looking for a lawyer', 'attorney'],
    ["I'm looking for a list of mediators", 'mediator'],
    ['someone for mediation', 'mediator'],
    ['a CDFA please', 'financial'],
    ['a therapist for my kids', 'therapist'],
    ['a counselor', 'therapist'],
    ['help selling our house, a realtor', 'real_estate'],
    ['a bankruptcy attorney', 'bankruptcy_attorney'],
    ['who can do a QDRO', 'qdro_attorney'],
    ['estate planning after the divorce', 'estate_attorney'],
    ['a divorce coach', 'coach'],
    ['hello there', null],
    // One they already have, not one they are looking for.
    ['my lawyer filed last week', null],
    ['our mediator quit', null],
  ])('"%s" asks for %s', (text, expected) => {
    expect(categoryFromText(text)).toBe(expected);
  });

  it.each([
    ['I need a divorce attorney', 'divorce'],
    ["I'm looking for a mediator in the boston area", 'divorce'],
    ['My husband and I are splitting up', 'divorce'],
    ["I'm a mediator, how do I join?", 'professional'],
    ['I am a family lawyer', 'professional'],
    ['how does membership work', 'professional'],
    ['hi', null],
  ])('at the first question, "%s" means %s', (text, expected) => {
    expect(welcomeFromText(text)).toBe(expected);
  });

  it.each([
    ['in the boston area', { state: 'MA', place: 'Boston' }],
    ['I live in West Virginia', { state: 'WV', place: null }],
    ['Virginia', { state: 'VA', place: null }],
    ['near Washington DC', { state: 'DC', place: null }],
    ['washington state', { state: 'WA', place: null }],
    ['st. louis', { state: 'MO', place: 'St. Louis' }],
    ['my ZIP is 30060', { state: null, place: '30060' }],
    ['Arkansas', { state: 'AR', place: null }],
    ['nowhere in particular', { state: null, place: null }],
  ])('finds the state and place in "%s"', (text, expected) => {
    expect(placeFromText(text, geo)).toEqual(expected);
  });
});
