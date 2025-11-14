const { body } = require('express-validator');

const validateAndSanitize = (validations) => {
  return validations;
};

const commonValidations = {
  email: body('email').isEmail().normalizeEmail(),
  password: body('password').isLength({ min: 6 }),
  name: body('full_name').trim().isLength({ min: 1 })
};

module.exports = {
  validateAndSanitize,
  commonValidations
};