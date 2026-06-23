ALTER TABLE withdrawal_requests ADD COLUMN wallet_type TEXT
    CHECK(wallet_type IS NULL OR wallet_type IN (
        'Vodafone Cash',
        'Orange Cash',
        'Etisalat Cash',
        'InstaPay'
    ));
