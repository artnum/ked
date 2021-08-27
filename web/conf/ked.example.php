<?php

// most of it should be stored in the directory
$KEDConfiguration = [
    'ldap' => [
        [
            'type' => 'rw',
            'uri' => 'ldap://127.0.0.1:9090',
            'base' => 'o=artnum',
            'creds' => [ 
                'type' => 'simple', 
                'user' => 'cn=admin,o=artnum', 
                'password' => '1234'
            ]
        ]
    ],
    'store' => [
        [
            'type' => 'rw',
            'path' => '/tmp/',
            'max-text-size' => 4096
        ]
    ],
    'upload' => [
        'path' => '/tmp',
        'max-upload-size' => 107374182400
    ],
    'message' => [
        [
            'address' => '127.0.0.1',
            'port' => 8531,
            'key' => 'ked-demo-key'
        ]
    ],
    'acl' => [
        /* when nothing set in anyway */
        'default' => [
            'everything',
            '-delete'
        ],
        'ownobject' => [
            'access',
            'create',
            'create:sub',
            'create:entry',
            'delete',
            'undelete',
            'tag',
            'untag',
            'archive',
            'unarchive'
        ]
    ]
];