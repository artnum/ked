<?php

namespace ked;

class state {
    function __construct($base, $ldap) {
        $this->ldap = $ldap;
        $this->base = $this->search_base($base);
    }

    function search_base(string $base):string {
        $res = @ldap_search(
            $this->ldap,
            $base,
            '(objectclass=kedRoot)',
            [ 'kedRootType' ]
        );
        if (!$res) { return $base; }
        for ($entry = @ldap_first_entry($this->ldap, $res); $entry; $entry = ldap_next_entry($this->ldap, $entry)) {
            $kedRootType = @ldap_get_values($this->ldap, $entry, 'kedRootType');
            if (!$kedRootType) { continue; }
            if ($kedRootType['count'] <= 0) { continue; }
            $dn = @ldap_get_dn($this->ldap, $entry);
            if ($kedRootType[0] === 'state') {
                return $dn;
            }
        }
        return $base;
    }

    function connection ($clientid, $userDn, $remote) {
        $object = [
            'objectClass' => 'kedState',
            'kedId' => $clientid,
            'kedObjectDn' => $userDn,
            'kedTimestamp' => (new \DateTime())->getTimestamp(),
            'kedContent' => $remote,
            'kedType' => 'connection'
        ];
        
        $dn = 'kedId=' . ldap_escape($clientid, '', LDAP_ESCAPE_DN) . '+kedType=connection,' . $this->base;
        $res = @ldap_read($this->ldap, $dn, '(objectclass=*)', [ 'kedTimestamp' ]);
        if ($res) {
            $entry = @ldap_first_entry($this->ldap, $res);
            if ($entry) {
                $res = ldap_mod_replace($this->ldap, $dn, ['kedTimestamp' => $object['kedTimestamp'], 'kedContent' => $object['kedContent']]);
                if (!$res) {
                    error_log(__LINE__ . ' ' . ldap_error($this->ldap));
                }
                return;
            }
        }
        $res = @ldap_add($this->ldap, $dn, $object);
        if (!$res) {
            error_log(__LINE__ . ' ' . ldap_error($this->ldap));
        }
        return;
    }

    function getconnected () {
        $res = @ldap_search($this->ldap, $this->base, '(kedType=connection)', [ 'kedObjectDn', 'kedTimestamp' ]);
        if (!$res) { return []; }
        $users = [];
        for($entry = @ldap_first_entry($this->ldap, $res); $entry; $entry = ldap_next_entry($this->ldap, $entry)) {
            $dn = @ldap_get_values($this->ldap, $entry, 'kedObjectDn');
            if (!$dn) { continue; }
            $ts = @ldap_get_values($this->ldap, $entry, 'kedTimestamp');
            if (!$ts) { continue; }
            $users[] = [ 'dn' => $dn[0], 'timestamp' => $ts[0] ];
        }
        return $users;
    }

    function disconnection ($clientid) {
        $dn = 'kedId=' . ldap_escape($clientid, '', LDAP_ESCAPE_DN) . '+kedType=connection,' . $this->base;
        $res = @ldap_delete($this->ldap, $dn);
        if (!$res) {
            error_log(__LINE__ . ' ' . ldap_error($this->ldap));
        }
        /* when client disconnect, remove all locks he helds */
        return $this->rmclientlocks($clientid);
    }

    function lock ($clientid, $objectdn, &$currentLock) {
        $object = [
            'objectClass' => 'kedState',
            'kedId' => $clientid,
            'kedObjectDn' => $objectdn,
            'kedTimestamp' => (new \DateTime())->getTimestamp(),
            'kedContent' => md5($objectdn),
            'kedType' => 'lock'
        ];
        
        $currentLock = $this->islocked($objectdn);
        if ($currentLock && $currentLock !== $clientid) { return false; }
        $dn = 'kedId=' . ldap_escape($clientid, '', LDAP_ESCAPE_DN) . '+kedType=lock+kedContent=' . ldap_escape($object['kedContent'], '', LDAP_ESCAPE_DN)  . ',' . $this->base;
        $res = @ldap_read($this->ldap, $dn, '(objectclass=*)', [ 'kedTimestamp' ]);
        if ($res) {
            $entry = @ldap_first_entry($this->ldap, $res);
            if ($entry) {
                $res = ldap_mod_replace($this->ldap, $dn, ['kedTimestamp' => $object['kedTimestamp']]);
                if (!$res) {
                    error_log(__LINE__ . ' ' . ldap_error($this->ldap));
                    return false;
                }
                return true;
            }
        }
        $res = @ldap_add($this->ldap, $dn, $object);
        if (!$res) {
            error_log(__LINE__ . ' ' . ldap_error($this->ldap));
            return false;
        }
        return true;
    }

    function islocked($objectdn) {
        $res = @ldap_search(
            $this->ldap,
            $this->base, 
            '(&(kedObjectDn=' . ldap_escape($objectdn, '', LDAP_ESCAPE_FILTER) . ')(kedType=lock))',
            [ 'kedTimestamp', 'kedId' ]
        );
        if (!$res) { return false; }
        $entry = @ldap_first_entry($this->ldap, $res);
        if (!$entry) { return false; }
        $clientid = @ldap_get_values($this->ldap, $entry, 'kedId');
        if (!$clientid) { return false; }
        if ($clientid['count'] < 1) { return false; }
        return $clientid[0];
    }

    function haslock($clientid, $objectdn) {
        $res = @ldap_search(
            $this->ldap,
            $this->base, 
            '(&(kedObjectDn=' . ldap_escape($objectdn, '', LDAP_ESCAPE_FILTER) . ')(kedId=' . ldap_escape($clientid, '', LDAP_ESCAPE_FILTER) . ')(kedType=lock))',
            [ 'kedTimestamp' ]
        );
        if (!$res) { return false; }
        $entry = @ldap_first_entry($this->ldap, $res);
        if (!$entry) { return false; }
        return ldap_get_dn($this->ldap, $entry);
    }

    function unlock($clientid, $objectdn) {
        $lockdn = $this->haslock($clientid, $objectdn);
        if ($lockdn) {
            @ldap_delete($this->ldap, $lockdn);
        }
        return true; // can't unlock, what can I do ?
    }

    function getobjectid ($dn) {
        $res = @ldap_read($this->ldap, $dn, '(objectclass=*)', ['kedId']);
        if (!$res) { return null; }
        $entry = @ldap_first_entry($this->ldap, $res);
        if (!$entry) { return null; }
        $id = @ldap_get_values($this->ldap, $entry, 'kedId');
        if (!$id) { return null; }
        if ($id['count'] === 0) { return null; }
        return $id[0];
    }

    function rmclientlocks ($clientid) {
        $res = @ldap_search(
            $this->ldap,
            $this->base,
            '(&(kedId=' . ldap_escape($clientid, '', LDAP_ESCAPE_FILTER) . ')(kedType=lock))',
            [ 'dn', 'kedObjectDn' ]
        );
        if (!$res) { return false; }
        $unlockedObjects = [];
        for ($entry = @ldap_first_entry($this->ldap, $res); $entry; $entry = @ldap_next_entry($this->ldap, $entry)) {
            $dn = @ldap_get_dn($this->ldap, $entry);
            $objectDn = @ldap_get_values($this->ldap, $entry, 'kedObjectDn');
            if (!$dn) { continue; }
            @ldap_delete($this->ldap, $dn);
            if (!$objectDn) { continue; }
            for ($i = 0; $i < $objectDn['count']; $i++) {
                $id = $this->getobjectid($objectDn[$i]);
                if ($id) {     
                    $unlockedObjects[] = $id;
                }
            }
        }
        return $unlockedObjects;
    }
}