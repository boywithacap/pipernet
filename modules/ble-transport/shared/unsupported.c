/* This build includes only the algorithms used by our fixed Noise suite.
 * Keep the upstream sources unmodified; unsupported factories fail closed. */
#include "internal.h"
NoiseDHState *noise_curve448_new(void) { return 0; }
NoiseDHState *noise_newhope_new(void) { return 0; }
NoiseHashState *noise_blake2s_new(void) { return 0; }
NoiseHashState *noise_blake2b_new(void) { return 0; }
NoiseCipherState *noise_aesgcm_new_ref(void) { return 0; }
