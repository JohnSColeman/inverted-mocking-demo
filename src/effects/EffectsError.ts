export class EffectsError extends Error {
    constructor(errors: Error[]) {
        super(errors.map(e => e.message).join('; '));
        this.name = 'EffectsError';
    }
}