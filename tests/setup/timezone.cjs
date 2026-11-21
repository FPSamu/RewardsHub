/**
 * Los tests corren en UTC, como Render y el lab (user_data pone TZ=UTC).
 * Tiene que ser globalSetup: dentro de un archivo de test, process.env es una
 * copia y cambiar TZ ahí no afecta a las fechas.
 */
module.exports = async () => {
    process.env.TZ = 'UTC';
};
